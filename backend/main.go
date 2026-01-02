package main

import (
	"bufio"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/input"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"github.com/rs/cors"
)

// --- Structs and Config ---
type Business struct {
	Name, Phone, Website, Rating, Reviews, Category, Address, Link string
}

// UPDATED: Changed City/State to ZipCodes (string to allow "10001, 10002")
type ScrapeRequest struct {
	FileName string `json:"fileName"`
	ZipCodes string `json:"zipCodes"` // Expects comma separated: "10001, 10002"
	Category string `json:"category"`
}

type ScrapeResponse struct {
	Status     string     `json:"status"`
	Message    string     `json:"message"`
	NewEntries int        `json:"newEntries"`
	Updates    int        `json:"updates"`
	Skipped    int        `json:"skipped"`
	Total      int        `json:"total"`
	Businesses []Business `json:"businesses"`
}

type ProgressUpdate struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Current int    `json:"current"`
	Total   int    `json:"total"`
}

var userAgents = []string{
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
}

func scrapeGoogleMaps(req ScrapeRequest, progressChan chan<- ProgressUpdate) (*ScrapeResponse, error) {
	rand.Seed(time.Now().UnixNano())

	fileName := req.FileName
	if !strings.HasSuffix(fileName, ".csv") {
		fileName += ".csv"
	}

	// --- 1. Load Existing Data ---
	businessMap := make(map[string]Business)
	if _, err := os.Stat(fileName); err == nil {
		file, _ := os.Open(fileName)
		csvReader := csv.NewReader(file)
		records, _ := csvReader.ReadAll()
		file.Close()
		for i, row := range records {
			if i == 0 || len(row) < 8 {
				continue
			}
			b := Business{row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7]}
			businessMap[b.Link] = b
		}
	}

	// --- 2. Setup Browser with Anti-Bot Persistence ---
	randomUA := userAgents[rand.Intn(len(userAgents))]

	// Create a folder for Chrome data if it doesn't exist
	userDataDir := "./chrome_data"
	if _, err := os.Stat(userDataDir); os.IsNotExist(err) {
		os.Mkdir(userDataDir, 0755)
	}

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", false), // Keep false to see what happens/solve CAPTCHA
		chromedp.Flag("disable-blink-features", "AutomationControlled"),
		chromedp.UserAgent(randomUA),
		// CRITICAL FLAGS FOR ANTI-DETECTION:
		chromedp.Flag("user-data-dir", userDataDir), // Saves your session/cookies
		chromedp.Flag("enable-automation", false),   // Hides "Chrome is controlled by software"
		chromedp.Flag("restore-on-startup", false),
	)

	allocCtx, cancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer cancel()

	// Create context
	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()
	// Extended timeout for multi-zip scraping
	ctx, cancel = context.WithTimeout(ctx, 120*time.Minute)
	defer cancel()

	// --- 3. Browser Initialization ---
	chromedp.Run(ctx,
		chromedp.ActionFunc(func(ctx context.Context) error {
			// Mask webdriver property
			_, err := page.AddScriptToEvaluateOnNewDocument(`Object.defineProperty(navigator, 'webdriver', {get: () => undefined,});`).Do(ctx)
			return err
		}),
		network.SetExtraHTTPHeaders(network.Headers{"Accept-Language": "en-US,en;q=0.9"}),
		emulation.SetDeviceMetricsOverride(int64(1280+rand.Intn(200)), int64(800+rand.Intn(100)), 1.0, false),
	)

	// --- 4. Process Zip Codes (Search & Scroll Loop) ---
	// Split the input string "10001, 10002" into a slice
	rawZips := strings.Split(req.ZipCodes, ",")
	var zipCodes []string
	for _, z := range rawZips {
		cleaned := strings.TrimSpace(z)
		if cleaned != "" {
			zipCodes = append(zipCodes, cleaned)
		}
	}

	// If no zips provided, try to fallback or error. For now, assume at least one.
	if len(zipCodes) == 0 {
		return nil, fmt.Errorf("no valid zip codes provided")
	}

	// Map to hold unique links across ALL zip codes
	uniqueLinks := make(map[string]string)

	for i, zip := range zipCodes {
		query := fmt.Sprintf("%s in %s", req.Category, zip)
		progressChan <- ProgressUpdate{
			Type:    "info",
			Message: fmt.Sprintf("Processing Zip %s (%d/%d)...", zip, i+1, len(zipCodes)),
		}

		startUrl := fmt.Sprintf("https://www.google.com/maps/search/%s", strings.ReplaceAll(query, " ", "+"))

		// Navigate
		if err := chromedp.Run(ctx, chromedp.Navigate(startUrl), chromedp.WaitVisible(`div[role='feed']`, chromedp.ByQuery)); err != nil {
			log.Printf("Skipping zip %s due to load error: %v", zip, err)
			continue
		}

		// Scroll logic per Zip
		var linkNodes []*cdp.Node
		lastCount := 0
		stuckCount := 0
		// Lower max scrolls per zip since results are fewer per zip
		maxScrolls := 30

		for s := 0; s < maxScrolls; s++ {
			chromedp.Run(ctx,
				chromedp.Evaluate(`
					var feed = document.querySelector("div[role='feed']");
					feed.scrollTop = feed.scrollHeight;
				`, nil),
				chromedp.Sleep(time.Duration(1500+rand.Intn(1500))*time.Millisecond),
			)

			chromedp.Run(ctx, chromedp.Nodes(`a[href*="/maps/place/"]`, &linkNodes, chromedp.ByQueryAll))

			if len(linkNodes) == lastCount {
				stuckCount++
				if stuckCount >= 3 {
					break // Stop scrolling this zip
				}
			} else {
				stuckCount = 0
			}
			lastCount = len(linkNodes)
		}

		// Collect links for this Zip
		newInZip := 0
		for _, node := range linkNodes {
			l := node.AttributeValue("href")
			n := node.AttributeValue("aria-label")
			if l != "" && n != "" {
				if _, exists := uniqueLinks[l]; !exists {
					uniqueLinks[l] = n
					newInZip++
				}
			}
		}

		progressChan <- ProgressUpdate{
			Type:    "info",
			Message: fmt.Sprintf("Zip %s: Found %d unique businesses", zip, newInZip),
		}

		// Human pause between Zips
		time.Sleep(time.Duration(2000+rand.Intn(3000)) * time.Millisecond)
	}

	progressChan <- ProgressUpdate{
		Type:    "info",
		Message: fmt.Sprintf("Consolidated List: %d unique businesses. Starting Deep Scrape...", len(uniqueLinks)),
	}

	// --- 5. Deep Scrape (Iterate Unique Links) ---
	updates, newEntries, count, skipped := 0, 0, 0, 0

	for link, name := range uniqueLinks {
		count++

		// --- ANTI-BOT PAUSE ---
		// Standard pause
		sleepTime := time.Duration(1500+rand.Intn(2000)) * time.Millisecond
		// Longer pause every 10 items to look human
		if count%10 == 0 {
			sleepTime = 8 * time.Second
			progressChan <- ProgressUpdate{Type: "info", Message: "Taking a short break (human behavior)..."}
		}
		time.Sleep(sleepTime)

		var phone, website, ratingRaw, category, address string

		err := chromedp.Run(ctx,
			chromedp.Navigate(link),
			chromedp.ActionFunc(func(ctx context.Context) error {
				// Random mouse movement
				x, y := float64(rand.Intn(500)), float64(rand.Intn(500))
				return input.DispatchMouseEvent(input.MouseMoved, x, y).Do(ctx)
			}),
			chromedp.WaitVisible(`h1`, chromedp.ByQuery),
			chromedp.Sleep(time.Duration(500+rand.Intn(1000))*time.Millisecond),

			chromedp.Evaluate(`(function(){
				let btn = document.querySelector("button[data-tooltip='Copy phone number']");
				if(btn) return btn.getAttribute("aria-label") || btn.innerText;
				return "";
			})()`, &phone),
			chromedp.Evaluate(`(function(){
				let btn = document.querySelector("a[data-item-id='authority']");
				return btn ? btn.href : "";
			})()`, &website),
			chromedp.Evaluate(`(function(){
				let btn = document.querySelector("button[data-item-id='address']");
				return btn ? btn.getAttribute("aria-label") || btn.innerText : "";
			})()`, &address),
			chromedp.Evaluate(`(function(){
				let roleImg = document.querySelector('div[role="img"][aria-label*="stars"]');
				return roleImg ? roleImg.getAttribute("aria-label") : "";
			})()`, &ratingRaw),
			chromedp.Evaluate(`(function(){
				let catBtn = document.querySelector("button[jsaction*='category']");
				return catBtn ? catBtn.innerText : "";
			})()`, &category),
		)

		if err != nil {
			progressChan <- ProgressUpdate{
				Type:    "error",
				Message: fmt.Sprintf("Error scraping %s", name),
			}
			continue
		}

		phone = strings.TrimSpace(strings.ReplaceAll(phone, "Copy phone number", ""))
		phone = strings.ReplaceAll(phone, "Phone: ", "")
		address = strings.ReplaceAll(address, "Address: ", "")

		// Note: State filtering is removed here because we trust the Zip Code search results
		// If you still want to filter, you can parse the address string.

		progressChan <- ProgressUpdate{
			Type:    "scrape",
			Message: fmt.Sprintf("Scraped %s", name),
			Current: count,
			Total:   len(uniqueLinks),
		}

		ratingVal, reviewsCount := "", ""
		if ratingRaw != "" {
			parts := strings.Split(ratingRaw, " ")
			if len(parts) > 0 {
				ratingVal = parts[0]
			}
			if strings.Contains(ratingRaw, "(") {
				s, e := strings.Index(ratingRaw, "("), strings.Index(ratingRaw, ")")
				if s != -1 && e != -1 {
					reviewsCount = ratingRaw[s+1 : e]
				}
			}
		}

		existing, exists := businessMap[link]
		newData := Business{name, phone, website, ratingVal, reviewsCount, category, address, link}

		if exists {
			if existing.Reviews != newData.Reviews || existing.Phone != newData.Phone {
				businessMap[link] = newData
				updates++
			}
		} else {
			businessMap[link] = newData
			newEntries++
		}
	}

	// --- 6. Save ---
	file, _ := os.Create(fileName)
	writer := csv.NewWriter(file)
	writer.Write([]string{"Name", "Phone", "Website", "Rating", "Reviews", "Category", "Address", "System_Link_ID"})
	for _, b := range businessMap {
		writer.Write([]string{b.Name, b.Phone, b.Website, b.Rating, b.Reviews, b.Category, b.Address, b.Link})
	}
	writer.Flush()
	file.Close()

	// Convert to slice for response
	businesses := make([]Business, 0, len(businessMap))
	for _, b := range businessMap {
		businesses = append(businesses, b)
	}

	return &ScrapeResponse{
		Status:     "success",
		Message:    "Scraping completed",
		NewEntries: newEntries,
		Updates:    updates,
		Skipped:    skipped,
		Total:      len(businesses),
		Businesses: businesses,
	}, nil
}

func handleScrape(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ScrapeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	progressChan := make(chan ProgressUpdate, 100)

	go func() {
		result, err := scrapeGoogleMaps(req, progressChan)
		close(progressChan)

		if err != nil {
			log.Printf("Error: %v", err)
			return
		}

		log.Printf("Scraping completed: %d new, %d updated, %d skipped",
			result.NewEntries, result.Updates, result.Skipped)
	}()

	// For now, send immediate response (in production, use WebSockets for progress)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "started",
		"message": "Scraping job started",
	})
}

func main() {
	// Check if running in CLI mode
	if len(os.Args) > 1 && os.Args[1] == "cli" {
		runCLI()
		return
	}

	// HTTP Server mode
	mux := http.NewServeMux()
	mux.HandleFunc("/api/scrape", handleScrape)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
	})

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"http://localhost:3000", "http://localhost:3001"},
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type"},
	}).Handler(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	fmt.Printf("Server starting on port %s...\n", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}

func runCLI() {
	rand.Seed(time.Now().UnixNano())
	reader := bufio.NewReader(os.Stdin)

	fmt.Print("Enter CSV Filename (e.g., leads.csv): ")
	fileName, _ := reader.ReadString('\n')
	fileName = strings.TrimSpace(fileName)

	// UPDATED CLI INPUT
	fmt.Print("Enter Zip Codes (comma separated, e.g., 10001, 10002): ")
	zips, _ := reader.ReadString('\n')
	zips = strings.TrimSpace(zips)

	fmt.Print("Enter Category (e.g., Lawyer): ")
	category, _ := reader.ReadString('\n')
	category = strings.TrimSpace(category)

	req := ScrapeRequest{
		FileName: fileName,
		ZipCodes: zips, // Pass string directly
		Category: category,
	}

	progressChan := make(chan ProgressUpdate, 100)

	go func() {
		for update := range progressChan {
			fmt.Printf("[%s] %s\n", update.Type, update.Message)
		}
	}()

	result, err := scrapeGoogleMaps(req, progressChan)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("\nDone! %d New, %d Updated, %d Skipped.\n",
		result.NewEntries, result.Updates, result.Skipped)
}

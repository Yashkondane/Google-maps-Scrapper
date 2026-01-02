# Google Maps Business Scraper

A full-stack application for scraping business data from Google Maps with a Next.js frontend and Go backend.

## Architecture

- **Frontend**: Next.js 16 with React 19, TypeScript, and Tailwind CSS
- **Backend**: Go with ChromeDP for browser automation
- **Output**: CSV files with business data

## Prerequisites

- Node.js 18+ and npm/yarn
- Go 1.21+
- Chrome/Chromium browser

## Setup Instructions

### 1. Start the Go Backend

```bash
cd backend
go mod download
go run main.go
```

The backend will start on `http://localhost:8080`

### 2. Start the Next.js Frontend

```bash
npm install
npm run dev
```

The frontend will start on `http://localhost:3000`

## How It Works

1. Enter search parameters in the frontend (city, state code, category)
2. Click "Start Scraping" to send a request to the Go backend
3. The Go backend uses ChromeDP to:
   - Navigate to Google Maps
   - Search for businesses matching your criteria
   - Scroll through all results
   - Extract detailed information from each business
   - Filter results by state to ensure accuracy
   - Save data to a CSV file on the server

4. Results are saved to the CSV file specified (default: `leads.csv`)

## Features

- Infinite scroll to load all available results
- State-based filtering to ensure accurate location data
- Extracts: business name, phone, website, rating, reviews, category, address
- Human-like behavior (random delays, mouse movements) to avoid detection
- Deduplication and data merging with existing CSV files
- Progress tracking and error handling

## Backend API

### POST /api/scrape

Start a scraping job.

**Request:**
```json
{
  "fileName": "leads.csv",
  "city": "Andalusia",
  "state": "AL",
  "category": "Lawyer"
}
```

**Response:**
```json
{
  "status": "started",
  "message": "Scraping job started"
}
```

### GET /health

Health check endpoint.

## Environment Variables

### Backend (Optional)

- `PORT` - Server port (default: 8080)

### Frontend (Optional)

- `GO_BACKEND_URL` - Go backend URL (default: http://localhost:8080)

## CLI Mode

You can also run the scraper directly from the command line:

```bash
cd backend
go run main.go cli
```

This will prompt you for inputs and run the scraper without the web interface.

## Notes

- The scraper runs in non-headless mode so you can see the browser automation
- Results are saved to CSV files on the backend server
- For production use, consider adding WebSocket support for real-time progress updates
- Respect Google Maps terms of service and rate limits when using this tool
"# Google-maps-Scrapper" 

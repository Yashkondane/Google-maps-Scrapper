"use client"

import { Suspense, useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { MapPin, Search, Download, Loader2, CheckCircle2, AlertCircle, Upload, RefreshCw } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

type Business = {
  Name: string
  Phone: string
  Website: string
  Rating: string
  Reviews: string
  Category: string
  Address: string
  System_Link_ID: string
}

type ScraperStatus = "idle" | "running" | "completed" | "error"

function GoogleMapsScraperContent() {
  const [fileName, setFileName] = useState("leads.csv")
  const [city, setCity] = useState("")
  const [stateCode, setStateCode] = useState("")
  const [category, setCategory] = useState("")
  const [status, setStatus] = useState<ScraperStatus>("idle")
  const [progress, setProgress] = useState(0)
  const [currentAction, setCurrentAction] = useState("")
  const [results, setResults] = useState<Business[]>([])
  const [stats, setStats] = useState({ new: 0, updated: 0, skipped: 0, total: 0 })
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleStartScrape = async () => {
    setStatus("running")
    setProgress(10)
    setResults([])
    setError("")
    setCurrentAction("Starting scraping job...")

    try {
      console.log("[v0] Calling scrape API with:", { fileName, city, stateCode, category })

      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName,
          city,
          stateCode,
          category,
        }),
      })

      const data = await response.json()
      console.log("[v0] Scrape API response:", data)

      if (!response.ok) {
        throw new Error(data.details || data.error || "Failed to start scraping")
      }

      setProgress(30)
      setCurrentAction("Scraping job started on backend...")

      // Since the Go backend runs the scraping job asynchronously,
      // we simulate progress here. In production, you'd use WebSockets
      // or polling to get real-time updates from the Go backend
      await simulateProgress(100)

      setCurrentAction("Scraping completed! (Check backend logs for results)")
      setStatus("completed")

      // Note: The Go backend saves results to CSV file on the server
      // To display results here, you'd need to add an endpoint to fetch them
      // or return them in the initial response (for smaller datasets)
      setStats({
        new: 0,
        updated: 0,
        skipped: 0,
        total: 0,
      })
    } catch (err) {
      console.error("[v0] Scraping error:", err)
      setError(err instanceof Error ? err.message : "An error occurred")
      setStatus("error")
      setProgress(0)
    }
  }

  const simulateProgress = (target: number) => {
    return new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= target) {
            clearInterval(interval)
            resolve()
            return target
          }
          return prev + 2
        })
      }, 100)
    })
  }

  // Load CSV data from API
  const loadCSVData = async () => {
    setIsLoadingData(true)
    setError("")
    try {
      const response = await fetch(`/api/csv/data?fileName=${encodeURIComponent(fileName)}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to load CSV data")
      }

      setResults(data.data || [])
      setStats((prev) => ({ ...prev, total: data.total || 0 }))
    } catch (err) {
      console.error("Error loading CSV data:", err)
      setError(err instanceof Error ? err.message : "Failed to load CSV data")
    } finally {
      setIsLoadingData(false)
    }
  }

  // Load data on mount and when fileName changes
  useEffect(() => {
    loadCSVData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName])

  const handleDownloadCSV = async () => {
    try {
      const response = await fetch(`/api/csv/download?fileName=${encodeURIComponent(fileName)}`)
      if (!response.ok) {
        throw new Error("Failed to download CSV file")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Download error:", err)
      setError(err instanceof Error ? err.message : "Failed to download CSV file")
    }
  }

  const handleUploadCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.name.endsWith(".csv")) {
      setError("Please upload a CSV file")
      return
    }

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (file.size > maxSize) {
      setError(`File size exceeds the maximum limit of 50MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB`)
      return
    }

    setIsUploading(true)
    setError("")
    setSuccess("")

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("fileName", fileName)

      const response = await fetch("/api/csv/upload", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        // Build detailed error message
        let errorMsg = data.error || "Failed to upload CSV file"
        if (data.details) {
          errorMsg += `: ${data.details}`
        }
        if (data.expectedColumns && data.receivedColumns) {
          errorMsg += `\n\nExpected columns: ${data.expectedColumns.join(", ")}\nReceived columns: ${data.receivedColumns.join(", ")}`
        }
        throw new Error(errorMsg)
      }

      setSuccess(
        `CSV uploaded successfully! ${data.newRecords} new records added, ${data.skippedRecords} skipped. Total: ${data.totalRecords} records.`,
      )

      // Auto-clear success message after 5 seconds
      setTimeout(() => setSuccess(""), 5000)

      // Refresh data to show updated results
      await loadCSVData()

      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    } catch (err) {
      console.error("Upload error:", err)
      setError(err instanceof Error ? err.message : "Failed to upload CSV file")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-balance">Google Maps Business Scraper</h1>
              <p className="text-sm text-muted-foreground">Extract business data from Google Maps</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="mb-6 border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200">{success}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Search Configuration</CardTitle>
                <CardDescription>Enter your search parameters</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fileName">CSV Filename</Label>
                  <Input
                    id="fileName"
                    placeholder="leads.csv"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    disabled={status === "running"}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    placeholder="Andalusia"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={status === "running"}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="stateCode">State Code</Label>
                  <Input
                    id="stateCode"
                    placeholder="AL"
                    value={stateCode}
                    onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                    maxLength={2}
                    disabled={status === "running"}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    placeholder="Lawyer"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    disabled={status === "running"}
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={handleStartScrape}
                  disabled={!city || !stateCode || !category || status === "running"}
                >
                  {status === "running" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Scraping...
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Start Scraping
                    </>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground">Note: Ensure the Go backend is running on port 8080</p>

                <div className="pt-4 border-t">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="csvUpload">Upload CSV File</Label>
                      <div className="flex gap-2">
                        <Input
                          id="csvUpload"
                          type="file"
                          accept=".csv"
                          ref={fileInputRef}
                          onChange={handleUploadCSV}
                          disabled={isUploading}
                          className="flex-1"
                        />
                        {isUploading && <Loader2 className="h-4 w-4 animate-spin mt-2" />}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Upload a CSV file with columns: Name, Phone, Website, Rating, Reviews, Category, Address,
                        System_Link_ID
                      </p>
                    </div>

                    <Button
                      onClick={handleDownloadCSV}
                      variant="outline"
                      className="w-full"
                      disabled={isLoadingData || results.length === 0}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download CSV
                    </Button>

                    <Button onClick={loadCSVData} variant="outline" className="w-full" disabled={isLoadingData}>
                      <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingData ? "animate-spin" : ""}`} />
                      Refresh Data
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {status !== "idle" && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Progress</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{currentAction}</span>
                      <span className="font-medium">{progress}%</span>
                    </div>
                    <Progress value={progress} />
                  </div>

                  {status === "completed" && (
                    <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span className="font-medium">Scraping job completed</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Results are saved to <code className="rounded bg-muted px-1">{fileName}</code> on the backend
                        server
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>CSV Data</CardTitle>
                    <CardDescription>
                      {results.length > 0
                        ? `${results.length} records loaded from ${fileName}`
                        : `No data in ${fileName}. Upload a CSV file or run a scrape.`}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingData ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <p className="mt-4 text-sm font-medium">Loading data...</p>
                  </div>
                ) : results.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
                    <div className="rounded-full bg-muted p-3">
                      <Search className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="mt-4 text-sm font-medium">No Data Available</p>
                    <p className="text-sm text-muted-foreground text-center max-w-md mt-2">
                      Upload a CSV file or run a scraping job to see data here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-md border">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="px-4 py-3 text-left font-medium">Name</th>
                              <th className="px-4 py-3 text-left font-medium">Phone</th>
                              <th className="px-4 py-3 text-left font-medium">Website</th>
                              <th className="px-4 py-3 text-left font-medium">Rating</th>
                              <th className="px-4 py-3 text-left font-medium">Reviews</th>
                              <th className="px-4 py-3 text-left font-medium">Category</th>
                              <th className="px-4 py-3 text-left font-medium">Address</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.slice(0, 100).map((business, index) => (
                              <tr key={index} className="border-b hover:bg-muted/50">
                                <td className="px-4 py-3">{business.Name || "-"}</td>
                                <td className="px-4 py-3">{business.Phone || "-"}</td>
                                <td className="px-4 py-3">
                                  {business.Website ? (
                                    <a
                                      href={business.Website}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-primary hover:underline truncate block max-w-[200px]"
                                    >
                                      {business.Website}
                                    </a>
                                  ) : (
                                    "-"
                                  )}
                                </td>
                                <td className="px-4 py-3">{business.Rating || "-"}</td>
                                <td className="px-4 py-3">{business.Reviews || "-"}</td>
                                <td className="px-4 py-3">{business.Category || "-"}</td>
                                <td className="px-4 py-3">{business.Address || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {results.length > 100 && (
                        <div className="px-4 py-3 text-sm text-muted-foreground border-t">
                          Showing first 100 of {results.length} records. Download the full CSV to see all records.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function GoogleMapsScraperPage() {
  return (
    <Suspense fallback={null}>
      <GoogleMapsScraperContent />
    </Suspense>
  )
}

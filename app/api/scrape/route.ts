import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { fileName, city, stateCode, category } = await request.json()

    // Validate inputs
    if (!city || !stateCode || !category) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Call the Go backend
    const goBackendUrl = process.env.GO_BACKEND_URL || "http://localhost:8080"
    const response = await fetch(`${goBackendUrl}/api/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: fileName || "leads.csv",
        city,
        state: stateCode,
        category,
      }),
    })

    if (!response.ok) {
      throw new Error(`Go backend returned ${response.status}`)
    }

    const data = await response.json()

    return NextResponse.json({
      status: "success",
      message: "Scraping job started successfully",
      data,
    })
  } catch (error) {
    console.error("[v0] Scrape API error:", error)
    return NextResponse.json(
      {
        error: "Failed to start scraping job",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

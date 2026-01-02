import { type NextRequest, NextResponse } from "next/server"
import { readFile } from "fs/promises"
import { join } from "path"

// Fixed CSV schema - must match exactly
const REQUIRED_COLUMNS = [
  "Name",
  "Phone",
  "Website",
  "Rating",
  "Reviews",
  "Category",
  "Address",
  "System_Link_ID",
]

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const fileName = searchParams.get("fileName") || "leads.csv"

    // Ensure filename ends with .csv
    const csvFileName = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`

    // Path to CSV file in backend directory
    const filePath = join(process.cwd(), "backend", csvFileName)

    try {
      const fileContent = await readFile(filePath, "utf-8")

      return new NextResponse(fileContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${csvFileName}"`,
        },
      })
    } catch (error) {
      // If file doesn't exist, return empty CSV with headers
      const emptyCSV = REQUIRED_COLUMNS.join(",") + "\n"
      return new NextResponse(emptyCSV, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${csvFileName}"`,
        },
      })
    }
  } catch (error) {
    console.error("Download CSV error:", error)
    return NextResponse.json(
      {
        error: "Failed to download CSV file",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}


import { type NextRequest, NextResponse } from "next/server"
import { readFile } from "fs/promises"
import { join } from "path"
import { parse } from "csv-parse/sync"

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

      // Parse CSV
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Business[]

      return NextResponse.json({
        status: "success",
        data: records,
        total: records.length,
      })
    } catch (error) {
      // If file doesn't exist, return empty array
      return NextResponse.json({
        status: "success",
        data: [],
        total: 0,
      })
    }
  } catch (error) {
    console.error("Get CSV data error:", error)
    return NextResponse.json(
      {
        error: "Failed to read CSV file",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}


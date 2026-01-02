import { type NextRequest, NextResponse } from "next/server"
import { readFile, writeFile } from "fs/promises"
import { join } from "path"
import { parse } from "csv-parse/sync"
import { stringify } from "csv-stringify/sync"

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

function validateCSVHeaders(headers: string[]): { valid: boolean; error?: string } {
  // Check if headers match exactly
  if (headers.length !== REQUIRED_COLUMNS.length) {
    return {
      valid: false,
      error: `Expected ${REQUIRED_COLUMNS.length} columns, but found ${headers.length}`,
    }
  }

  // Check column names and order
  for (let i = 0; i < REQUIRED_COLUMNS.length; i++) {
    if (headers[i] !== REQUIRED_COLUMNS[i]) {
      return {
        valid: false,
        error: `Column ${i + 1} should be "${REQUIRED_COLUMNS[i]}", but found "${headers[i]}"`,
      }
    }
  }

  return { valid: true }
}

function removeDuplicateHeaders(records: Business[]): Business[] {
  // Use System_Link_ID as unique identifier to prevent duplicates
  const seen = new Set<string>()
  const unique: Business[] = []

  for (const record of records) {
    const id = record.System_Link_ID || `${record.Name}-${record.Address}`
    if (!seen.has(id)) {
      seen.add(id)
      unique.push(record)
    }
  }

  return unique
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const fileName = (formData.get("fileName") as string) || "leads.csv"

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: "File too large",
          details: `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds the maximum limit of 50MB`,
        },
        { status: 400 },
      )
    }

    // Ensure filename ends with .csv
    const csvFileName = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`

    // Read uploaded file
    const fileContent = await file.text()

    // Parse first line to get headers
    const lines = fileContent.split("\n").filter((line) => line.trim())
    if (lines.length === 0) {
      return NextResponse.json({ error: "Uploaded CSV file is empty" }, { status: 400 })
    }

    // Parse header row
    const headerRow = parse(lines[0], {
      skip_empty_lines: false,
      trim: true,
    })[0] as string[]

    // Validate headers before parsing the rest
    const validation = validateCSVHeaders(headerRow)
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: "CSV validation failed",
          details: validation.error,
          expectedColumns: REQUIRED_COLUMNS,
          receivedColumns: headerRow,
        },
        { status: 400 },
      )
    }

    // Parse uploaded CSV with validated headers
    const uploadedRecords = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Business[]

    if (uploadedRecords.length === 0) {
      return NextResponse.json({ error: "Uploaded CSV file contains no data rows" }, { status: 400 })
    }

    // Path to existing CSV file in backend directory
    const filePath = join(process.cwd(), "backend", csvFileName)

    // Load existing data
    let existingRecords: Business[] = []
    try {
      const existingContent = await readFile(filePath, "utf-8")
      existingRecords = parse(existingContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Business[]
    } catch (error) {
      // File doesn't exist yet, that's okay
      existingRecords = []
    }

    // Create a map of existing records by System_Link_ID
    const existingMap = new Map<string, Business>()
    for (const record of existingRecords) {
      const id = record.System_Link_ID || `${record.Name}-${record.Address}`
      existingMap.set(id, record)
    }

    // Remove duplicates from uploaded data
    const uniqueUploaded = removeDuplicateHeaders(uploadedRecords)

    // Merge: only add new records (don't overwrite existing)
    let newCount = 0
    const allRecords: Business[] = [...existingRecords]

    for (const record of uniqueUploaded) {
      const id = record.System_Link_ID || `${record.Name}-${record.Address}`
      if (!existingMap.has(id)) {
        allRecords.push(record)
        existingMap.set(id, record)
        newCount++
      }
    }

    // Write merged data back to file
    const csvContent = stringify(allRecords, {
      header: true,
      columns: REQUIRED_COLUMNS,
    })

    await writeFile(filePath, csvContent, "utf-8")

    return NextResponse.json({
      status: "success",
      message: "CSV file uploaded and merged successfully",
      newRecords: newCount,
      skippedRecords: uniqueUploaded.length - newCount,
      totalRecords: allRecords.length,
    })
  } catch (error) {
    console.error("Upload CSV error:", error)
    return NextResponse.json(
      {
        error: "Failed to upload CSV file",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}


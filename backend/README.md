# Google Maps Scraper Backend

This is the Go backend for the Google Maps business scraper.

## Prerequisites

- Go 1.21 or higher
- Chrome/Chromium browser installed

## Installation

```bash
cd backend
go mod download
```

## Running the Backend

### HTTP Server Mode (for Next.js integration)

```bash
go run main.go
```

The server will start on port 8080 by default. You can change this by setting the `PORT` environment variable.

### CLI Mode (standalone)

```bash
go run main.go cli
```

This will prompt you for inputs and run the scraper directly.

## API Endpoints

### POST /api/scrape

Start a scraping job.

**Request Body:**
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

## Integration with Next.js

Make sure the Go backend is running before starting your Next.js frontend. The frontend will make requests to `http://localhost:8080/api/scrape`.
```

```ts file="" isHidden

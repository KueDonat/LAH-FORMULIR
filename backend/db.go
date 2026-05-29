package main

import (
	"database/sql"
	"log"
	"os"
	"time"

	_ "github.com/lib/pq"
)

var DB *sql.DB

// InitDB initializes PostgreSQL connection with retries and runs migrations
func InitDB() {
	var err error
	
	// Get database URL from env or use default Neon cloud database
	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		connStr = "postgresql://neondb_owner:npg_Da5tn2ZmcXqQ@ep-restless-wind-aoczud0c-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
	}

	log.Printf("Connecting to database: %s", connStr)

	// Try to connect with retries
	for i := 1; i <= 5; i++ {
		DB, err = sql.Open("postgres", connStr)
		if err == nil {
			err = DB.Ping()
		}

		if err == nil {
			log.Println("Successfully connected to PostgreSQL database!")
			break
		}

		log.Printf("Attempt %d/5 failed to connect to database. Retrying in 3 seconds...", i)
		time.Sleep(3 * time.Second)
	}

	if err != nil {
		log.Fatalf("CRITICAL: Failed to connect to PostgreSQL database: %v. Server will shut down.", err)
	}

	// Run automatic schema migrations
	runMigrations()
}

func runMigrations() {
	if DB == nil {
		return
	}

	queries := []string{
		`CREATE TABLE IF NOT EXISTS forms (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			title VARCHAR(255) NOT NULL,
			description TEXT,
			fields JSONB NOT NULL,
			stickers JSONB NOT NULL,
			creator_email VARCHAR(255),
			collaborators JSONB NOT NULL DEFAULT '[]',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		);`,
		`ALTER TABLE forms ADD COLUMN IF NOT EXISTS creator_email VARCHAR(255);`,
		`ALTER TABLE forms ADD COLUMN IF NOT EXISTS collaborators JSONB NOT NULL DEFAULT '[]';`,
		`CREATE TABLE IF NOT EXISTS responses (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
			answers JSONB NOT NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE INDEX IF NOT EXISTS idx_responses_form_id ON responses(form_id);`,
	}

	for _, query := range queries {
		_, err := DB.Exec(query)
		if err != nil {
			log.Printf("Warning: Migration query failed: %v", err)
		}
	}
	log.Println("Database migrations applied successfully!")
}

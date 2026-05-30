package handler

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

// --- DATABASE CONFIGURATION & INITIALIZATION ---

var DB *sql.DB

// InitDB initializes PostgreSQL connection with retries and runs migrations
func InitDB() {
	// Optimization for serverless: reuse existing connection if already established
	if DB != nil {
		return
	}

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

// --- DATA STRUCTURES & REST API HANDLERS ---

// Form represents a custom zine form design
type Form struct {
	ID            string          `json:"id"`
	Title         string          `json:"title"`
	Description   string          `json:"description"`
	Fields        json.RawMessage `json:"fields"`   // JSONB array of questions
	Stickers      json.RawMessage `json:"stickers"` // JSONB array of stickers layout
	CreatorEmail  string          `json:"creator_email"`
	Collaborators json.RawMessage `json:"collaborators"`
	CreatedAt     time.Time       `json:"created_at"`
}

// FormResponse represents a submitted response to a form
type FormResponse struct {
	ID        string          `json:"id"`
	FormID    string          `json:"form_id"`
	Answers   json.RawMessage `json:"answers"` // JSONB answer mappings
	CreatedAt time.Time       `json:"created_at"`
}

// Helper to enable CORS for preflight and standard requests
func enableCORS(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return true
	}
	return false
}

// POST /api/forms - Create a new form design
func createFormHandler(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req Form
	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.Title == "" {
		req.Title = "Untitled Zine Form"
	}
	if req.Fields == nil {
		req.Fields = json.RawMessage("[]")
	}
	if req.Stickers == nil {
		req.Stickers = json.RawMessage("[]")
	}
	if req.Collaborators == nil {
		req.Collaborators = json.RawMessage("[]")
	}

	if DB == nil {
		http.Error(w, "Database connection unavailable", http.StatusServiceUnavailable)
		return
	}

	query := `
		INSERT INTO forms (title, description, fields, stickers, creator_email, collaborators)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at;
	`
	err = DB.QueryRow(query, req.Title, req.Description, req.Fields, req.Stickers, req.CreatorEmail, req.Collaborators).Scan(&req.ID, &req.CreatedAt)
	if err != nil {
		log.Printf("DB Error saving form: %v", err)
		http.Error(w, "Database error saving form", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(req)
}

// GET /api/forms/{id} - Load a specific form layout
func getFormHandler(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Simple routing helper to get ID from URL "/api/forms/{id}"
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 || parts[3] == "" {
		http.Error(w, "Missing Form ID", http.StatusBadRequest)
		return
	}
	formID := parts[3]

	var form Form

	if DB == nil {
		http.Error(w, "Database connection unavailable", http.StatusServiceUnavailable)
		return
	}

	query := `SELECT id, title, description, fields, stickers, COALESCE(creator_email, ''), COALESCE(collaborators, '[]'), created_at FROM forms WHERE id = $1`
	err := DB.QueryRow(query, formID).Scan(&form.ID, &form.Title, &form.Description, &form.Fields, &form.Stickers, &form.CreatorEmail, &form.Collaborators, &form.CreatedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "Form not found", http.StatusNotFound)
		return
	} else if err != nil {
		log.Printf("DB Error fetching form: %v", err)
		http.Error(w, "Database error loading form", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(form)
}

// POST /api/forms/{id}/responses - Submit responses to a form
func submitResponseHandler(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Route path: /api/forms/{id}/responses
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 || parts[3] == "" {
		http.Error(w, "Missing Form ID", http.StatusBadRequest)
		return
	}
	formID := parts[3]

	var req FormResponse
	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}
	req.FormID = formID

	if req.Answers == nil {
		req.Answers = json.RawMessage("{}")
	}

	if DB == nil {
		http.Error(w, "Database connection unavailable", http.StatusServiceUnavailable)
		return
	}

	query := `
		INSERT INTO responses (form_id, answers)
		VALUES ($1, $2)
		RETURNING id, created_at;
	`
	err = DB.QueryRow(query, req.FormID, req.Answers).Scan(&req.ID, &req.CreatedAt)
	if err != nil {
		log.Printf("DB Error saving response: %v", err)
		http.Error(w, "Database error saving response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(req)
}

// GET /api/forms/{id}/responses - Retrieve list of responses for a form
func getResponsesHandler(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 || parts[3] == "" {
		http.Error(w, "Missing Form ID", http.StatusBadRequest)
		return
	}
	formID := parts[3]

	responses := []FormResponse{}

	if DB == nil {
		http.Error(w, "Database connection unavailable", http.StatusServiceUnavailable)
		return
	}

	query := `SELECT id, form_id, answers, created_at FROM responses WHERE form_id = $1 ORDER BY created_at DESC`
	rows, err := DB.Query(query, formID)
	if err != nil {
		log.Printf("DB Error fetching responses: %v", err)
		http.Error(w, "Database error loading responses", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var resp FormResponse
		err = rows.Scan(&resp.ID, &resp.FormID, &resp.Answers, &resp.CreatedAt)
		if err != nil {
			log.Printf("DB Scan Error: %v", err)
			continue
		}
		responses = append(responses, resp)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(responses)
}

// GET /api/forms?email={email} - Retrieve all forms created by or shared with a user
func listFormsHandler(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	email := r.URL.Query().Get("email")
	if email == "" {
		http.Error(w, "Missing email query parameter", http.StatusBadRequest)
		return
	}
	email = strings.ToLower(email)

	forms := []Form{}

	if DB == nil {
		http.Error(w, "Database connection unavailable", http.StatusServiceUnavailable)
		return
	}

	// Fetch forms owned by user or where they are listed in collaborators JSONB array
	query := `
		SELECT id, title, description, fields, stickers, COALESCE(creator_email, ''), COALESCE(collaborators, '[]'), created_at 
		FROM forms 
		WHERE LOWER(creator_email) = $1 OR collaborators @> jsonb_build_array($2::text)
		ORDER BY created_at DESC
	`
	rows, err := DB.Query(query, email, email)
	if err != nil {
		log.Printf("DB Error fetching user forms: %v", err)
		http.Error(w, "Database error loading forms", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var f Form
		err = rows.Scan(&f.ID, &f.Title, &f.Description, &f.Fields, &f.Stickers, &f.CreatorEmail, &f.Collaborators, &f.CreatedAt)
		if err != nil {
			log.Printf("DB Scan Error in forms list: %v", err)
			continue
		}
		forms = append(forms, f)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(forms)
}

// PUT /api/forms/{id} - Update an existing form design
func updateFormHandler(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}

	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 || parts[3] == "" {
		http.Error(w, "Missing Form ID", http.StatusBadRequest)
		return
	}
	formID := parts[3]

	var req Form
	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.Title == "" {
		req.Title = "Untitled Zine Form"
	}
	if req.Fields == nil {
		req.Fields = json.RawMessage("[]")
	}
	if req.Stickers == nil {
		req.Stickers = json.RawMessage("[]")
	}
	if req.Collaborators == nil {
		req.Collaborators = json.RawMessage("[]")
	}

	if DB == nil {
		http.Error(w, "Database connection unavailable", http.StatusServiceUnavailable)
		return
	}

	query := `
		UPDATE forms
		SET title = $1, description = $2, fields = $3, stickers = $4, collaborators = $5
		WHERE id = $6;
	`
	_, err = DB.Exec(query, req.Title, req.Description, req.Fields, req.Stickers, req.Collaborators, formID)
	if err != nil {
		log.Printf("DB Error updating form %s: %v", formID, err)
		http.Error(w, "Database error updating form", http.StatusInternalServerError)
		return
	}

	req.ID = formID
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(req)
}

// DELETE /api/forms/{id} - Delete an existing form design
func deleteFormHandler(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}

	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 || parts[3] == "" {
		http.Error(w, "Missing Form ID", http.StatusBadRequest)
		return
	}
	formID := parts[3]

	if DB == nil {
		http.Error(w, "Database connection unavailable", http.StatusServiceUnavailable)
		return
	}

	query := `DELETE FROM forms WHERE id = $1;`
	_, err := DB.Exec(query, formID)
	if err != nil {
		log.Printf("DB Error deleting form %s: %v", formID, err)
		http.Error(w, "Database error deleting form", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Form deleted successfully", "id": formID})
}

// DELETE /api/forms/{id}/responses/{response_id} - Delete a single response
func deleteSingleResponseHandler(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}

	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 6 || parts[3] == "" || parts[5] == "" {
		http.Error(w, "Missing Form ID or Response ID", http.StatusBadRequest)
		return
	}
	formID := parts[3]
	responseID := parts[5]

	if DB == nil {
		http.Error(w, "Database connection unavailable", http.StatusServiceUnavailable)
		return
	}

	query := `DELETE FROM responses WHERE id = $1 AND form_id = $2;`
	_, err := DB.Exec(query, responseID, formID)
	if err != nil {
		log.Printf("DB Error deleting response %s: %v", responseID, err)
		http.Error(w, "Database error deleting response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Response deleted successfully", "id": responseID})
}

// DELETE /api/forms/{id}/responses - Delete all responses for a form
func deleteAllResponsesHandler(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}

	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 || parts[3] == "" {
		http.Error(w, "Missing Form ID", http.StatusBadRequest)
		return
	}
	formID := parts[3]

	if DB == nil {
		http.Error(w, "Database connection unavailable", http.StatusServiceUnavailable)
		return
	}

	query := `DELETE FROM responses WHERE form_id = $1;`
	_, err := DB.Exec(query, formID)
	if err != nil {
		log.Printf("DB Error deleting all responses for form %s: %v", formID, err)
		http.Error(w, "Database error deleting responses", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "All responses deleted successfully", "form_id": formID})
}

// --- SERVERLESS ENTRYPOINT ROUTER ---

// Handler is the serverless entrypoint for Vercel Go runtime.
// It initializes the DB connection and dynamically routes HTTP requests.
func Handler(w http.ResponseWriter, r *http.Request) {
	// Initialize database connection (performs a check if DB is already open for container reuse)
	InitDB()

	path := r.URL.Path

	// Standard clean routing equivalent to backend/main.go
	if path == "/api/forms" || path == "/api/forms/" {
		// Handle CORS preflight
		if enableCORS(w, r) {
			return
		}
		
		if r.Method == http.MethodPost {
			createFormHandler(w, r)
		} else if r.Method == http.MethodGet {
			listFormsHandler(w, r)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	if strings.HasPrefix(path, "/api/forms/") {
		// Handle CORS preflight
		if enableCORS(w, r) {
			return
		}

		parts := strings.Split(path, "/")
		// Expected path formats:
		// 1. GET /api/forms/{id} (length 4: ["", "api", "forms", "{id}"])
		// 2. PUT /api/forms/{id} (length 4: ["", "api", "forms", "{id}"])
		// 3. POST /api/forms/{id}/responses (length 5: ["", "api", "forms", "{id}", "responses"])
		// 4. GET /api/forms/{id}/responses (length 5: ["", "api", "forms", "{id}", "responses"])
		// 5. DELETE /api/forms/{id}/responses/{response_id} (length 6)

		if len(parts) == 4 && parts[3] != "" {
			if r.Method == http.MethodGet {
				getFormHandler(w, r)
			} else if r.Method == http.MethodPut {
				updateFormHandler(w, r)
			} else if r.Method == http.MethodDelete {
				deleteFormHandler(w, r)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}

		if len(parts) == 5 && parts[3] != "" && parts[4] == "responses" {
			if r.Method == http.MethodPost {
				submitResponseHandler(w, r)
			} else if r.Method == http.MethodGet {
				getResponsesHandler(w, r)
			} else if r.Method == http.MethodDelete {
				deleteAllResponsesHandler(w, r)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}

		if len(parts) == 6 && parts[3] != "" && parts[4] == "responses" && parts[5] != "" {
			if r.Method == http.MethodDelete {
				deleteSingleResponseHandler(w, r)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}
	}

	log.Printf("Endpoint not found: %s", path)
	http.Error(w, "Endpoint not found", http.StatusNotFound)
}

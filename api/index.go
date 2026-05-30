package handler

import (
	"log"
	"net/http"
	"strings"
)

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

		if len(parts) == 4 && parts[3] != "" {
			if r.Method == http.MethodGet {
				getFormHandler(w, r)
			} else if r.Method == http.MethodPut {
				updateFormHandler(w, r)
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
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}
	}

	log.Printf("Endpoint not found: %s", path)
	http.Error(w, "Endpoint not found", http.StatusNotFound)
}

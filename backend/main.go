package main

import (
	"log"
	"net/http"
	"os"
	"strings"
)

func main() {
	log.Println("--- STREET LABS BACKEND STARTING ---")

	// Initialize Database (will fallback to In-Memory if PostgreSQL is not active)
	InitDB()
	if DB != nil {
		defer DB.Close()
	}

	// Simple Custom Router
	http.HandleFunc("/api/forms", func(w http.ResponseWriter, r *http.Request) {
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
	})

	http.HandleFunc("/api/forms/", func(w http.ResponseWriter, r *http.Request) {
		// Handle CORS preflight
		if enableCORS(w, r) {
			return
		}

		path := r.URL.Path
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

		http.Error(w, "Endpoint not found", http.StatusNotFound)
	})

	// Get port from environment or default to 8080
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Rebel Zine Backend is running on http://localhost:%s 🛹", port)
	err := http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatalf("Server crashed: %v", err)
	}
}

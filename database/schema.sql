-- Schema for Street Labs // Rebel Zine - Streetwear Form Builder

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table to store form designs (questions, choice options, and stickers positions)
CREATE TABLE IF NOT EXISTS forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    fields JSONB NOT NULL,     -- Array of question fields: [{id, type, label, options: [], required}]
    stickers JSONB NOT NULL,   -- Array of sticker bombing decorations: [{type, x, y, rotation, scale}]
    creator_email VARCHAR(255), -- Email of the admin user who created the form
    collaborators JSONB NOT NULL DEFAULT '[]', -- JSON array of collaborator emails
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table to store form submissions
CREATE TABLE IF NOT EXISTS responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    answers JSONB NOT NULL,    -- Key-value mappings: {"field_id_1": "answer text", "field_id_2": ["option1"]}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for speed
CREATE INDEX IF NOT EXISTS idx_responses_form_id ON responses(form_id);

-- Semantic search: เก็บ chunk + embedding (JSON array) จาก Ollama embeddings
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id          BIGSERIAL PRIMARY KEY,
  file        TEXT NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  content     TEXT NOT NULL,
  embedding   JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_file ON knowledge_embeddings (file);

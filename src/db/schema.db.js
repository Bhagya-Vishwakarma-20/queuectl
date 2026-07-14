export function initializeSchema(db) {

    db.exec(`
        CREATE TABLE IF NOT EXISTS workers (
            id TEXT PRIMARY KEY,
            pid INTEGER NOT NULL,
            last_heartbeat DATETIME NOT NULL,
            started_at DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS jobs (
            
            id TEXT PRIMARY KEY,
            command TEXT NOT NULL,

            state TEXT NOT NULL CHECK (
                state IN (
                    'pending',
                    'processing',
                    'completed',
                    'failed',
                    'dead'
                )
            ),

            attempts INTEGER NOT NULL DEFAULT 0,
            max_retries INTEGER NOT NULL DEFAULT 3,
            
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            
            worker_id TEXT,
            next_retry_at DATETIME,

            priority INTEGER NOT NULL DEFAULT 0,

            FOREIGN KEY (worker_id)
                REFERENCES workers(id)
                ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS supervisors (
            pid INTEGER PRIMARY KEY,
            worker_count INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            shutdown_requested INTEGER NOT NULL DEFAULT 0
        );
    `);
}
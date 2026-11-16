use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};

use crate::application::CounterRepository;
use crate::domain::CounterBook;

pub struct FileCounterRepository {
    path: PathBuf,
}

impl FileCounterRepository {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }
}

impl CounterRepository for FileCounterRepository {
    fn load(&self) -> Result<CounterBook> {
        if !self.path.exists() {
            return Ok(CounterBook::default());
        }
        let data = fs::read(&self.path)
            .with_context(|| format!("failed to read {}", self.path.display()))?;
        serde_json::from_slice(&data)
            .with_context(|| format!("failed to parse {}", self.path.display()))
    }

    fn save(&self, book: &CounterBook) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        let data = serde_json::to_vec_pretty(book)?;
        let tmp = self.path.with_extension("tmp");
        fs::write(&tmp, data)?;
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

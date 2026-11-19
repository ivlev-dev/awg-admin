mod app;
mod audit;
mod auth;
mod billing;
mod clients;
mod import;
mod network;
mod stats;

pub use app::*;
pub use audit::*;
pub use auth::*;
pub use billing::*;
pub use clients::*;
pub use import::*;
pub use network::*;
pub use stats::*;

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct PageView<T> {
    pub items: Vec<T>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

impl<T> PageView<T> {
    pub fn new(items: Vec<T>, total: usize, limit: usize, offset: usize) -> Self {
        Self {
            items,
            total,
            limit,
            offset,
        }
    }
}

use std::io;

use awg_shared::{CoreError, CoreResult};

use crate::error::{ApiError, ApiResult};

pub(crate) async fn run_core<T>(
    work: impl FnOnce() -> CoreResult<T> + Send + 'static,
) -> CoreResult<T>
where
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work).await.map_err(join_core)?
}

pub(crate) async fn run_api<T>(work: impl FnOnce() -> ApiResult<T> + Send + 'static) -> ApiResult<T>
where
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| ApiError::Internal(format!("blocking task failed: {error}")))?
}

pub(crate) async fn run_ignored<T>(work: impl FnOnce() -> T + Send + 'static) -> Option<T>
where
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(work).await {
        Ok(value) => Some(value),
        Err(error) => {
            tracing::warn!(%error, "blocking task failed");
            None
        }
    }
}

fn join_core(error: tokio::task::JoinError) -> CoreError {
    CoreError::Io(io::Error::other(format!("blocking task failed: {error}")))
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;

    #[tokio::test(flavor = "current_thread")]
    async fn run_core_keeps_the_runtime_responsive() {
        let started = Instant::now();
        let blocking = run_core(|| {
            std::thread::sleep(Duration::from_millis(300));
            Ok(())
        });
        let timer = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            started.elapsed()
        };
        let (result, timer_elapsed) = tokio::join!(blocking, timer);

        result.unwrap();
        assert!(
            timer_elapsed < Duration::from_millis(200),
            "the async timer was delayed by blocking work: {timer_elapsed:?}"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn run_api_propagates_handler_errors() {
        let result: ApiResult<()> = run_api(|| Err(ApiError::BadRequest("nope".into()))).await;
        assert!(matches!(result, Err(ApiError::BadRequest(message)) if message == "nope"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn run_ignored_returns_the_value() {
        assert_eq!(run_ignored(|| 7u32).await, Some(7));
    }
}

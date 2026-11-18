#[tokio::main]
async fn main() -> anyhow::Result<()> {
    awg_admin::run().await
}

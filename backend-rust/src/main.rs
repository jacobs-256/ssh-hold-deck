#[tokio::main]
async fn main() {
    if let Err(error) = ssh_hold_backend::run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

use cloudpiovt_native_host::*;
use std::io;

fn main() -> Result<(), NativeHostError> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();

    loop {
        match read_message(&mut input)? {
            Some(request) => {
                let response = handle_request(request);
                write_message(&mut output, &response)?;
            }
            None => break,
        }
    }

    Ok(())
}

export async function listen(app, {host = '127.0.0.1', port = 3001} = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, error => error ? reject(error) : resolve(server));
    server.once('error', reject);
  });
}

const autocannon = require('autocannon');
const http = require('http');

async function runBenchmark() {
  // First login to get a cookie
  const loginData = new URLSearchParams();
  loginData.append('username', 'admin');
  loginData.append('password', 'admin');

  const req = http.request('http://localhost:8090/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }, (res) => {
    const cookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0] : '';
    console.log('Got cookie:', cookie);

    if (!cookie) {
      console.error('Failed to get cookie');
      return;
    }

    const url = 'http://localhost:8090/api/config';
    console.log(`Running benchmark on ${url}`);

    const instance = autocannon({
      url: url,
      connections: 100,
      pipelining: 1,
      duration: 5,
      headers: {
        'Cookie': cookie
      }
    });

    autocannon.track(instance, {renderProgressBar: true});

    instance.on('done', (result) => {
      console.log(`\nBenchmark completed.`);
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency avg: ${result.latency.average} ms`);
      console.log(`Throughput avg: ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/sec`);
    });
  });

  req.write(loginData.toString());
  req.end();
}

runBenchmark();

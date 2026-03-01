const assert = require('assert');
const http = require('http');

async function testEndpoint() {
  const loginData = new URLSearchParams();
  loginData.append('username', 'admin');
  loginData.append('password', 'admin');

  const req = http.request('http://localhost:8090/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, (res) => {
    const cookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0] : '';
    assert.ok(cookie, 'Got cookie');

    const configReq = http.request('http://localhost:8090/api/config', {
      headers: { 'Cookie': cookie }
    }, (configRes) => {
      let data = '';
      configRes.on('data', chunk => { data += chunk; });
      configRes.on('end', () => {
        assert.strictEqual(configRes.statusCode, 200, 'Endpoint returned 200');
        const json = JSON.parse(data);
        assert.ok(json.hasOwnProperty('content'), 'Response has content field');
        console.log('Test passed!');
      });
    });
    configReq.end();
  });
  req.write(loginData.toString());
  req.end();
}

testEndpoint();

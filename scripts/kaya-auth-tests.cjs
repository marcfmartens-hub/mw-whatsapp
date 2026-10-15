const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
delete process.env.MONITOR_SECRET;delete process.env.CRON_SECRET;process.env.KAYA_IMPROVE_SECRET='isolated-test-secret';
const modulePath=path.join(process.argv[2],'auth.js');let auth=require(modulePath);
assert.equal(auth.verifyToken(auth.createToken('admin-test')),'admin-test');
const p=JSON.stringify({username:'admin-test',ts:Date.now()}),sig=crypto.createHmac('sha256','mw-monitor-fallback').update(p).digest('hex');assert.equal(auth.verifyToken(Buffer.from(`${p}.${sig}`).toString('base64url')),null);
delete process.env.KAYA_IMPROVE_SECRET;delete require.cache[require.resolve(modulePath)];auth=require(modulePath);assert.throws(()=>auth.createToken('admin-test'));assert.equal(auth.verifyToken('any'),null);
console.log('Monitor sessions require a configured secret; former public-fallback tokens are rejected.');

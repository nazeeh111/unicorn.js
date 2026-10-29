// Memory reads return owned bytes and retain native errors without leaking buffers.
const assert = require('assert');
const path = require('path');
const distPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'dist', 'unicorn.js');

require(distPath)().then((uc) => {
  const e = new uc.Unicorn(uc.ARCH_X86, uc.MODE_64);
  const address = 0x10000;
  const bytes = Uint8Array.from({ length: 8192 }, (_, i) => (i * 73 + 19) & 255);
  try {
    e.mem_map(address, bytes.length, uc.PROT_ALL);
    e.mem_write(address, bytes);
    for (const offset of [0, 1, 3, 7]) {
      for (const size of [0, 1, 2, 3, 4, 7, 8, 4095, 4096, 4101]) {
        const actual = e.mem_read(address + offset, size);
        assert(actual instanceof Uint8Array);
        assert.deepStrictEqual(actual, bytes.slice(offset, offset + size));
      }
    }
    assert.deepStrictEqual(e.mem_read(address, '7'), bytes.slice(0, 7));
    const saved = e.mem_read(address, bytes.length);
    e.mem_write(address, new Uint8Array(bytes.length).fill(255));
    assert.deepStrictEqual(e.mem_read(address, bytes.length), new Uint8Array(bytes.length).fill(255));
    assert.deepStrictEqual(saved, bytes);

    const allocate = uc._malloc;
    const free = uc._free;
    const call = uc.ccall;
    const allocated = [];
    const freed = [];
    try {
      uc._malloc = (size) => { const pointer = allocate(size); allocated.push(pointer); return pointer; };
      uc._free = (pointer) => { freed.push(pointer); free(pointer); };
      assert.throws(
        () => e.mem_read(address + bytes.length - 3, 7),
        (error) => typeof error === 'string' && error.includes('UC_ERR_READ_UNMAPPED')
      );
      assert.deepStrictEqual(freed, allocated);
      assert.strictEqual(allocated.length, 1);

      const failure = new Error('controlled native-call failure');
      uc.ccall = (name, ...args) => {
        if (name === 'uc_mem_read') throw failure;
        return call(name, ...args);
      };
      assert.throws(() => e.mem_read(address, 4), (error) => error === failure);
      assert.deepStrictEqual(freed, allocated);
      assert.strictEqual(allocated.length, 2);
    } finally {
      uc._malloc = allocate;
      uc._free = free;
      uc.ccall = call;
    }
    console.log('MEM_READ: PASS');
  } finally {
    e.close();
  }
}).catch((error) => {
  console.error('MEM_READ: FAIL', error);
  process.exitCode = 1;
});

// A small, proven MD5 implementation (UTF-8).
// Exports: md5(string) -> 32-char lowercase hex

function toUtf8Bytes(str) {
  return new TextEncoder().encode(str);
}

function bytesToWords(bytes) {
  const words = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >>> 2] |= bytes[i] << ((i % 4) * 8);
  }
  return words;
}

function wordsToHex(words) {
  let hex = '';
  for (let i = 0; i < words.length * 4; i++) {
    const byte = (words[i >>> 2] >>> ((i % 4) * 8)) & 0xff;
    hex += (byte >>> 4).toString(16);
    hex += (byte & 0x0f).toString(16);
  }
  return hex;
}

function add32(a, b) {
  return (a + b) >>> 0;
}

function rol(num, cnt) {
  return (num << cnt) | (num >>> (32 - cnt));
}

function cmn(q, a, b, x, s, t) {
  return add32(rol(add32(add32(a, q), add32(x, t)), s), b);
}

function ff(a, b, c, d, x, s, t) {
  return cmn((b & c) | (~b & d), a, b, x, s, t);
}
function gg(a, b, c, d, x, s, t) {
  return cmn((b & d) | (c & ~d), a, b, x, s, t);
}
function hh(a, b, c, d, x, s, t) {
  return cmn(b ^ c ^ d, a, b, x, s, t);
}
function ii(a, b, c, d, x, s, t) {
  return cmn(c ^ (b | ~d), a, b, x, s, t);
}

function md5Core(words, byteLen) {
  // append padding
  words[byteLen >>> 2] |= 0x80 << ((byteLen % 4) * 8);
  words[(((byteLen + 8) >>> 6) << 4) + 14] = (byteLen * 8) >>> 0;

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let i = 0; i < words.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;

    a = ff(a, b, c, d, words[i + 0]  >>> 0, 7,  0xd76aa478);
    d = ff(d, a, b, c, words[i + 1]  >>> 0, 12, 0xe8c7b756);
    c = ff(c, d, a, b, words[i + 2]  >>> 0, 17, 0x242070db);
    b = ff(b, c, d, a, words[i + 3]  >>> 0, 22, 0xc1bdceee);
    a = ff(a, b, c, d, words[i + 4]  >>> 0, 7,  0xf57c0faf);
    d = ff(d, a, b, c, words[i + 5]  >>> 0, 12, 0x4787c62a);
    c = ff(c, d, a, b, words[i + 6]  >>> 0, 17, 0xa8304613);
    b = ff(b, c, d, a, words[i + 7]  >>> 0, 22, 0xfd469501);
    a = ff(a, b, c, d, words[i + 8]  >>> 0, 7,  0x698098d8);
    d = ff(d, a, b, c, words[i + 9]  >>> 0, 12, 0x8b44f7af);
    c = ff(c, d, a, b, words[i + 10] >>> 0, 17, 0xffff5bb1);
    b = ff(b, c, d, a, words[i + 11] >>> 0, 22, 0x895cd7be);
    a = ff(a, b, c, d, words[i + 12] >>> 0, 7,  0x6b901122);
    d = ff(d, a, b, c, words[i + 13] >>> 0, 12, 0xfd987193);
    c = ff(c, d, a, b, words[i + 14] >>> 0, 17, 0xa679438e);
    b = ff(b, c, d, a, words[i + 15] >>> 0, 22, 0x49b40821);

    a = gg(a, b, c, d, words[i + 1]  >>> 0, 5,  0xf61e2562);
    d = gg(d, a, b, c, words[i + 6]  >>> 0, 9,  0xc040b340);
    c = gg(c, d, a, b, words[i + 11] >>> 0, 14, 0x265e5a51);
    b = gg(b, c, d, a, words[i + 0]  >>> 0, 20, 0xe9b6c7aa);
    a = gg(a, b, c, d, words[i + 5]  >>> 0, 5,  0xd62f105d);
    d = gg(d, a, b, c, words[i + 10] >>> 0, 9,  0x02441453);
    c = gg(c, d, a, b, words[i + 15] >>> 0, 14, 0xd8a1e681);
    b = gg(b, c, d, a, words[i + 4]  >>> 0, 20, 0xe7d3fbc8);
    a = gg(a, b, c, d, words[i + 9]  >>> 0, 5,  0x21e1cde6);
    d = gg(d, a, b, c, words[i + 14] >>> 0, 9,  0xc33707d6);
    c = gg(c, d, a, b, words[i + 3]  >>> 0, 14, 0xf4d50d87);
    b = gg(b, c, d, a, words[i + 8]  >>> 0, 20, 0x455a14ed);
    a = gg(a, b, c, d, words[i + 13] >>> 0, 5,  0xa9e3e905);
    d = gg(d, a, b, c, words[i + 2]  >>> 0, 9,  0xfcefa3f8);
    c = gg(c, d, a, b, words[i + 7]  >>> 0, 14, 0x676f02d9);
    b = gg(b, c, d, a, words[i + 12] >>> 0, 20, 0x8d2a4c8a);

    a = hh(a, b, c, d, words[i + 5]  >>> 0, 4,  0xfffa3942);
    d = hh(d, a, b, c, words[i + 8]  >>> 0, 11, 0x8771f681);
    c = hh(c, d, a, b, words[i + 11] >>> 0, 16, 0x6d9d6122);
    b = hh(b, c, d, a, words[i + 14] >>> 0, 23, 0xfde5380c);
    a = hh(a, b, c, d, words[i + 1]  >>> 0, 4,  0xa4beea44);
    d = hh(d, a, b, c, words[i + 4]  >>> 0, 11, 0x4bdecfa9);
    c = hh(c, d, a, b, words[i + 7]  >>> 0, 16, 0xf6bb4b60);
    b = hh(b, c, d, a, words[i + 10] >>> 0, 23, 0xbebfbc70);
    a = hh(a, b, c, d, words[i + 13] >>> 0, 4,  0x289b7ec6);
    d = hh(d, a, b, c, words[i + 0]  >>> 0, 11, 0xeaa127fa);
    c = hh(c, d, a, b, words[i + 3]  >>> 0, 16, 0xd4ef3085);
    b = hh(b, c, d, a, words[i + 6]  >>> 0, 23, 0x04881d05);
    a = hh(a, b, c, d, words[i + 9]  >>> 0, 4,  0xd9d4d039);
    d = hh(d, a, b, c, words[i + 12] >>> 0, 11, 0xe6db99e5);
    c = hh(c, d, a, b, words[i + 15] >>> 0, 16, 0x1fa27cf8);
    b = hh(b, c, d, a, words[i + 2]  >>> 0, 23, 0xc4ac5665);

    a = ii(a, b, c, d, words[i + 0]  >>> 0, 6,  0xf4292244);
    d = ii(d, a, b, c, words[i + 7]  >>> 0, 10, 0x432aff97);
    c = ii(c, d, a, b, words[i + 14] >>> 0, 15, 0xab9423a7);
    b = ii(b, c, d, a, words[i + 5]  >>> 0, 21, 0xfc93a039);
    a = ii(a, b, c, d, words[i + 12] >>> 0, 6,  0x655b59c3);
    d = ii(d, a, b, c, words[i + 3]  >>> 0, 10, 0x8f0ccc92);
    c = ii(c, d, a, b, words[i + 10] >>> 0, 15, 0xffeff47d);
    b = ii(b, c, d, a, words[i + 1]  >>> 0, 21, 0x85845dd1);
    a = ii(a, b, c, d, words[i + 8]  >>> 0, 6,  0x6fa87e4f);
    d = ii(d, a, b, c, words[i + 15] >>> 0, 10, 0xfe2ce6e0);
    c = ii(c, d, a, b, words[i + 6]  >>> 0, 15, 0xa3014314);
    b = ii(b, c, d, a, words[i + 13] >>> 0, 21, 0x4e0811a1);
    a = ii(a, b, c, d, words[i + 4]  >>> 0, 6,  0xf7537e82);
    d = ii(d, a, b, c, words[i + 11] >>> 0, 10, 0xbd3af235);
    c = ii(c, d, a, b, words[i + 2]  >>> 0, 15, 0x2ad7d2bb);
    b = ii(b, c, d, a, words[i + 9]  >>> 0, 21, 0xeb86d391);

    a = add32(a, oa);
    b = add32(b, ob);
    c = add32(c, oc);
    d = add32(d, od);
  }

  return [a, b, c, d];
}

export function md5(str) {
  const bytes = toUtf8Bytes(str);
  const words = bytesToWords(bytes);
  const out = md5Core(words, bytes.length);
  return wordsToHex(out);
}


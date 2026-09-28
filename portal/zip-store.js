(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.GMTZipStore = api;
}(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  function bytesOf(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new TextEncoder().encode(String(value == null ? "" : value));
  }
  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (var bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function createZip(files) {
    var entries = [];
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    (Array.isArray(files) ? files : []).forEach(function (file) {
      var name = new TextEncoder().encode(String(file && file.name || "file"));
      var data = bytesOf(file && file.data);
      if (name.length > 65535 || data.length > 0xffffffff || offset > 0xffffffff) throw new Error("A workbook is too large to package in this download.");
      var checksum = crc32(data);
      var local = new Uint8Array(30 + name.length);
      var localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, 0, true);
      localView.setUint16(12, 33, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, name.length, true);
      localView.setUint16(28, 0, true);
      local.set(name, 30);
      localParts.push(local, data);

      var central = new Uint8Array(46 + name.length);
      var centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, 0, true);
      centralView.setUint16(14, 33, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      central.set(name, 46);
      centralParts.push(central);
      entries.push({ name: name, data: data });
      offset += local.length + data.length;
    });
    if (entries.length > 65535) throw new Error("Too many workbooks to package in one download.");
    var centralSize = centralParts.reduce(function (sum, part) { return sum + part.length; }, 0);
    if (offset > 0xffffffff || centralSize > 0xffffffff) throw new Error("The workbook archive is too large to download.");
    var end = new Uint8Array(22);
    var endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);
    var totalLength = offset + centralSize + end.length;
    var output = new Uint8Array(totalLength);
    var cursor = 0;
    localParts.concat(centralParts, [end]).forEach(function (part) { output.set(part, cursor); cursor += part.length; });
    return output;
  }
  return { createZip: createZip };
}));

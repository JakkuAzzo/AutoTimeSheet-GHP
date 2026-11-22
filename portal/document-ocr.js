(function (root) {
  'use strict';
  let loading;
  async function ensureEngine() {
    if (root.Tesseract) return root.Tesseract;
    if (!loading) loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      script.onload = () => root.Tesseract ? resolve(root.Tesseract) : reject(new Error('Image recognition is unavailable.'));
      script.onerror = () => reject(new Error('Image recognition is unavailable.'));
      document.head.append(script);
    }).catch(error => { loading = null; throw error; });
    return loading;
  }
  async function recognise(image, options) {
    const engine = await ensureEngine();
    const worker = await engine.createWorker('eng', 1, options || {});
    try {
      const result = await worker.recognize(image);
      return {text:String(result?.data?.text || ''), confidence:Number(result?.data?.confidence || 0)};
    } finally { await worker.terminate(); }
  }
  async function recogniseDates(image, options) {
    const engine = await ensureEngine();
    const worker = await engine.createWorker('eng', 1, options || {});
    try {
      await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:'0123456789/.-'});
      const result=await worker.recognize(image);
      return {text:String(result?.data?.text || ''),confidence:Number(result?.data?.confidence || 0)};
    } finally { await worker.terminate(); }
  }
  root.GMTDocumentOCR = {recognise,recogniseDates};
})(globalThis);

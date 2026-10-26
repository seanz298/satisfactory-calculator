(async () => {
  try {
    const raw = Uint8Array.from(atob("__BUNDLE_BASE64__"), (c) =>
      c.charCodeAt(0),
    );
    const stream = new Blob([raw])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    globalThis.__factoryBundle = JSON.parse(await new Response(stream).text());
    const script = document.createElement("script");
    script.textContent = document.getElementById("factorySource").textContent;
    document.body.append(script);
    document.getElementById("factorySource").remove();
    delete globalThis.__factoryBundle;
  } catch (error) {
    const box = document.createElement("p");
    box.textContent =
      "无法启动计算器，请用新版 Chrome、Edge 或 Firefox 打开。" + error.message;
    box.style.cssText = "padding:24px;color:#a62621";
    document.body.prepend(box);
  }
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => console.log("SW registered:", reg.scope))
      .catch((err) => console.error("SW registration failed:", err));
  });
}

const testHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
console.log("ethers version:", ethers.version);
console.log("test keccak256:", testHash);
document.getElementById("status").textContent = `Ready (ethers ${ethers.version})`;
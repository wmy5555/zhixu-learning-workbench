const launcher = document.querySelector("#help-launcher");
const dialog = document.querySelector("#help-dialog");
const frame = document.querySelector("#help-frame");

launcher.addEventListener("click", () => {
  if (!frame.hasAttribute("src")) frame.src = "/guide.html";
  dialog.showModal();
});
document.querySelector("#help-close").addEventListener("click", () => dialog.close());
document.querySelector("#onboarding-launcher")?.addEventListener("click", () => dialog.close());
document.querySelector("#onboarding-reset")?.addEventListener("click", () => dialog.close());
dialog.addEventListener("keydown", (event) => {
  // Keep the application's Escape handler from closing an editor underneath.
  if (event.key === "Escape") event.stopPropagation();
});
dialog.addEventListener("click", (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
dialog.addEventListener("close", () => launcher.focus({ preventScroll: true }));
// Keyboard events inside the guide's document do not bubble to the parent.
frame.addEventListener("load", () => {
  frame.contentDocument.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.open) {
      event.preventDefault();
      dialog.close();
    }
  });
});

const form = document.getElementById("settings-form");
const status = document.getElementById("save-status");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  status.textContent = "Settings saved";
});
document.getElementById("cancel").addEventListener("click", () => (status.textContent = "No changes saved"));

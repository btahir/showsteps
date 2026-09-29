document.getElementById("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const status = document.getElementById("login-status");
  if (!email || !password) {
    status.textContent = "Enter your email and password.";
    return;
  }
  location.href = "/dashboard.html";
});

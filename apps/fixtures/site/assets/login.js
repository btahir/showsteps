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

// ACCEPTANCE G4 negative control: ?mutate=1 renames the login button (the server's mutate mode does the same).
if (new URLSearchParams(location.search).get("mutate") === "1") document.getElementById("sign-in").textContent = "Log in";

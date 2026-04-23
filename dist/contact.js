document.getElementById("contactForm").addEventListener("submit", async function(e) {
  e.preventDefault();

  const formData = {
    name:    document.getElementById("name").value,
    email:   document.getElementById("email").value,
    message: document.getElementById("message").value
  };

  const response = await fetch("/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData)
  });

  const result = await response.json();
  alert(result.success ? "Message sent!" : "Error sending message.");
});

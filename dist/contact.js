document.getElementById("contact-form").addEventListener("submit", async function (e) {
  e.preventDefault();

  const submitBtn = document.getElementById("submit");
  const originalLabel = submitBtn.innerHTML;

  // Show loading state
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="alt-send-button"><span class="send-text">SENDING...</span></div>';

  const formData = {
    name:    document.getElementById("name").value.trim(),
    email:   document.getElementById("email").value.trim(),
    message: document.getElementById("message").value.trim()
  };

  // Basic client-side validation
  if (!formData.name || !formData.email || !formData.message) {
    showStatus("Please fill in all fields.", "error");
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalLabel;
    return;
  }

  try {
    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData)
    });

    const result = await response.json();

    if (result.success) {
      showStatus("✅ Message sent! We will get back to you soon.", "success");
      this.reset();
    } else {
      showStatus("❌ Failed to send message. Please try again or email us directly.", "error");
    }
  } catch (err) {
    console.error("Network error:", err);
    showStatus("❌ Network error. Please check your connection and try again.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalLabel;
  }
});

function showStatus(message, type) {
  // Remove existing status if any
  const existing = document.getElementById("form-status");
  if (existing) existing.remove();

  const statusDiv = document.createElement("div");
  statusDiv.id = "form-status";
  statusDiv.textContent = message;
  statusDiv.style.cssText = `
    margin-top: 12px;
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 14px;
    font-family: 'Lato', sans-serif;
    background-color: ${type === "success" ? "#d4edda" : "#f8d7da"};
    color:            ${type === "success" ? "#155724" : "#721c24"};
    border: 1px solid ${type === "success" ? "#c3e6cb" : "#f5c6cb"};
  `;

  const form = document.getElementById("contact-form");
  form.appendChild(statusDiv);

  // Auto-remove after 6 seconds
  setTimeout(() => statusDiv.remove(), 6000);
}

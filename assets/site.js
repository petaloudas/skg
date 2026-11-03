(() => {
  "use strict";

  const menu = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".nav");
  if (menu && navigation) {
    const closeMenu = () => {
      navigation.classList.remove("open");
      menu.setAttribute("aria-expanded", "false");
      menu.setAttribute("aria-label", "Open menu");
      const icon = menu.querySelector("span");
      if (icon) icon.textContent = "☰";
    };
    menu.addEventListener("click", () => {
      const open = navigation.classList.toggle("open");
      menu.setAttribute("aria-expanded", String(open));
      menu.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      const icon = menu.querySelector("span");
      if (icon) icon.textContent = open ? "×" : "☰";
    });
    navigation.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMenu));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeMenu();
    });
  }

  const serviceNames = {
    "ship-agency": "Ship Agency",
    opa: "Owners' Protecting Agency (OPA)",
    "crew-support": "Crew Change & Crew Support",
    "technical-support": "Marine Technical Support & Repairs",
    other: "Other maritime services"
  };
  const query = new URLSearchParams(location.search);
  const requestedService = query.get("service");
  const quoteService = document.querySelector("#quote-form select[name=service]");
  if (quoteService && Object.hasOwn(serviceNames, requestedService)) {
    quoteService.value = requestedService;
  }

  // Preserve campaign labels in internal navigation without cookies or storage.
  // Only bounded campaign identifiers are accepted, never full referral URLs.
  const campaign = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
    const value = query.get(key);
    if (value && /^[a-zA-Z0-9_-]{1,64}$/.test(value)) campaign[key] = value;
  }
  if (Object.keys(campaign).length) {
    document.querySelectorAll("a[href]").forEach(link => {
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol)) return;
      for (const [key, value] of Object.entries(campaign)) url.searchParams.set(key, value);
      link.href = url.href;
    });
  }

  // These PII-free browser events are integration points, not an analytics
  // collector. No Google/advertising tag is loaded without verified setup.
  const signal = (event, properties = {}) => {
    try {
      window.dispatchEvent(new CustomEvent("skg:measurement", {
        detail: { event, page: location.pathname, ...properties }
      }));
    } catch { /* Measurement must never interrupt a customer enquiry. */ }
  };
  document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href*="/request-quote/"]').forEach(link => {
    link.addEventListener("click", () => signal(
      link.protocol === "tel:" ? "phone_click" :
      link.protocol === "mailto:" ? "email_click" : "quote_open"
    ));
  });

  document.querySelectorAll("#contact-form, #quote-form").forEach(form => {
    let sending = false;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (sending || !form.reportValidity()) return;
      const details = new FormData(form);
      const status = form.querySelector(".form-status");
      const button = form.querySelector('button[type="submit"]');
      if (!status || !button || String(details.get("_honey") || "").trim()) return;
      const get = key => String(details.get(key) || "").trim();
      const quote = form.id === "quote-form";
      const required = quote
        ? ["name", "email", "company", "vessel", "service", "message"]
        : ["name", "email", "message"];
      if (required.some(key => !get(key))) {
        status.dataset.state = "error";
        status.textContent = "Please complete all required fields.";
        return;
      }
      const service = quote ? get("service") : "";
      if (quote && !Object.hasOwn(serviceNames, service)) {
        status.dataset.state = "error";
        status.textContent = "Please choose a service.";
        return;
      }
      const payload = {
        name: get("name"),
        email: get("email"),
        message: get("message"),
        _replyto: get("email"),
        _template: "table",
        _captcha: "false",
        _honey: "",
        _url: "https://skgportagency.gr" + location.pathname,
        enquiry_page: location.pathname,
        enquiry_type: quote ? "Proforma / Agency Quote" : "General enquiry",
        ...campaign
      };
      if (quote) {
        Object.assign(payload, {
          company: get("company"),
          phone: get("phone") || "Not provided",
          vessel: get("vessel"),
          imo: get("imo") || "Not provided",
          eta_thessaloniki_local_time: get("eta") || "To be confirmed",
          requested_service: serviceNames[service],
          _subject: `Agency quote — ${serviceNames[service]} — ${get("vessel")}`.slice(0, 180)
        });
      } else {
        payload._subject = get("subject") || "Website enquiry — SKG Port Agency";
        payload.subject = payload._subject;
      }
      sending = true;
      const controls = [...form.querySelectorAll("input, select, textarea, button")];
      const previousDisabled = controls.map(control => control.disabled);
      controls.forEach(control => { control.disabled = true; });
      const buttonText = button.textContent;
      form.setAttribute("aria-busy", "true");
      button.textContent = "Sending…";
      status.dataset.state = "pending";
      status.textContent = "Sending your enquiry…";
      signal("enquiry_started", { kind: quote ? "quote" : "contact", service });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch("https://formsubmit.co/ajax/office@skgportagency.gr", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        const result = await response.json();
        if (!response.ok || !(result.success === true || result.success === "true")) {
          throw new Error("Enquiry not accepted");
        }
        status.dataset.state = "success";
        status.textContent = quote
          ? "Thank you! Your quotation request has been submitted. We will review the scope and contact you. This is not a confirmed booking."
          : "Thank you! Your message has been submitted. We will get back to you soon.";
        form.reset();
        if (quoteService && Object.hasOwn(serviceNames, requestedService)) {
          quoteService.value = requestedService;
        }
        signal("enquiry_submitted", { kind: quote ? "quote" : "contact", service });
      } catch (error) {
        status.dataset.state = "error";
        status.textContent = error.name === "AbortError"
          ? "We could not confirm whether your enquiry was sent. Your details are still here. Please call or email us directly for urgent assistance."
          : "Your enquiry could not be sent. Your details are still here. Please try again later or contact us directly by phone or email.";
        signal("enquiry_failed", { kind: quote ? "quote" : "contact", service });
      } finally {
        clearTimeout(timeout);
        sending = false;
        form.removeAttribute("aria-busy");
        controls.forEach((control, index) => { control.disabled = previousDisabled[index]; });
        button.textContent = buttonText;
      }
    });
  });
})();

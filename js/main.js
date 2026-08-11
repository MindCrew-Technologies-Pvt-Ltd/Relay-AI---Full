/* Relay AI — interactions */
(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Hero video (version B): respect reduced motion ---------- */
  var heroVideo = document.querySelector(".hero__video");
  if (heroVideo && prefersReducedMotion) {
    heroVideo.removeAttribute("autoplay");
    heroVideo.pause();
  }

  /* ---------- Paper-stack sheets ----------
     A sheet taller than the viewport must scroll fully before pinning,
     so pin it at -(sheetHeight - viewportHeight) instead of 0. */
  var sheets = Array.prototype.slice.call(document.querySelectorAll(".sheet"));
  function sizeSheets() {
    sheets.forEach(function (sheet) {
      var overshoot = window.innerHeight - sheet.offsetHeight;
      sheet.style.top = (overshoot < 0 ? overshoot : 0) + "px";
    });
  }
  sizeSheets();
  window.addEventListener("resize", sizeSheets);
  window.addEventListener("load", sizeSheets);

  /* ---------- Sticky header ---------- */
  var header = document.getElementById("header");
  function onScroll() {
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile navigation ---------- */
  var nav = document.getElementById("nav");
  var navToggle = document.getElementById("navToggle");

  function closeNav() {
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open menu");
  }

  navToggle.addEventListener("click", function () {
    var open = nav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });

  nav.addEventListener("click", function (e) {
    if (e.target.closest("a")) closeNav();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      closeNav();
      navToggle.focus();
    }
  });

  /* ---------- Active section highlighting ----------
     Sections are sticky "sheets", so intersection ratios are unreliable —
     compare scroll position against each section's flow offset instead. */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav__link"));
  var navTargets = navLinks
    .map(function (link) {
      var section = document.getElementById(link.getAttribute("href").slice(1));
      return section ? { link: link, section: section } : null;
    })
    .filter(Boolean);

  function updateActiveLink() {
    var probe = window.scrollY + window.innerHeight * 0.4;
    var current = null;
    navTargets.forEach(function (t) {
      if (t.section.offsetTop <= probe) current = t;
    });
    navLinks.forEach(function (l) { l.classList.remove("is-active"); });
    if (current) current.link.classList.add("is-active");
  }
  window.addEventListener("scroll", updateActiveLink, { passive: true });
  window.addEventListener("resize", updateActiveLink);
  updateActiveLink();

  /* ---------- Sequential card entrance ---------- */
  var seqCards = Array.prototype.slice.call(document.querySelectorAll(".seq"));
  if (seqCards.length) {
    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      seqCards.forEach(function (el) { el.classList.add("is-visible"); });
    } else {
      var seqObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          seqObserver.unobserve(el);
          // one card lands, then the next — staggered by its position
          var order = parseInt(el.getAttribute("data-seq"), 10) || 0;
          window.setTimeout(function () { el.classList.add("is-visible"); }, order * 220);
        });
      }, { threshold: 0.2, rootMargin: "0px 0px -60px 0px" });
      seqCards.forEach(function (el) { seqObserver.observe(el); });
    }
  }

  /* ---------- Scroll reveal ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal, .step"));
  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- Animated counters (activate when data-count has a value) ---------- */
  var counters = Array.prototype.slice.call(document.querySelectorAll(".stat__value[data-count]"));
  counters = counters.filter(function (el) { return el.getAttribute("data-count") !== ""; });
  if (counters.length && "IntersectionObserver" in window && !prefersReducedMotion) {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        counterObserver.unobserve(el);
        var target = parseInt(el.getAttribute("data-count"), 10);
        var suffix = el.getAttribute("data-suffix") || "";
        var start = null;
        var duration = 1800;
        function tick(ts) {
          if (!start) start = ts;
          var p = Math.min((ts - start) / duration, 1);
          var eased = 1 - Math.pow(1 - p, 4);
          if (p < 1) {
            el.textContent = Math.round(target * eased) + suffix;
            requestAnimationFrame(tick);
          } else {
            // settle exactly on the target and stop
            el.textContent = target + suffix;
          }
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { counterObserver.observe(el); });
  } else {
    counters.forEach(function (el) {
      el.textContent = el.getAttribute("data-count") + (el.getAttribute("data-suffix") || "");
    });
  }

  /* ---------- FAQ accordion ---------- */
  var accordionItems = Array.prototype.slice.call(document.querySelectorAll(".accordion__item"));
  accordionItems.forEach(function (item) {
    var trigger = item.querySelector(".accordion__trigger");
    trigger.addEventListener("click", function () {
      var isOpen = item.classList.contains("is-open");
      accordionItems.forEach(function (other) {
        other.classList.remove("is-open");
        other.querySelector(".accordion__trigger").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        item.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
      }
    });
  });

  /* ---------- Services toggle (version B) ---------- */
  var svcToggle = document.querySelector(".svc-toggle");
  if (svcToggle) {
    var svcTabs = Array.prototype.slice.call(svcToggle.querySelectorAll(".svc-toggle__btn"));

    var activateTab = function (tab, focus) {
      svcToggle.setAttribute("data-active", String(svcTabs.indexOf(tab)));
      svcTabs.forEach(function (t) {
        var active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", String(active));
        t.tabIndex = active ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.classList.toggle("is-active", active);
      });
      if (focus) tab.focus();
    };

    svcTabs.forEach(function (tab) {
      tab.addEventListener("click", function () { activateTab(tab, false); });
      tab.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        var idx = svcTabs.indexOf(tab);
        var next = e.key === "ArrowRight" ? (idx + 1) % svcTabs.length : (idx - 1 + svcTabs.length) % svcTabs.length;
        activateTab(svcTabs[next], true);
      });
    });
  }

  /* ---------- Requirement pre-selection from CTAs ---------- */
  var requirementLinks = Array.prototype.slice.call(document.querySelectorAll("[data-requirement]"));
  requirementLinks.forEach(function (link) {
    link.addEventListener("click", function () {
      var value = link.getAttribute("data-requirement");
      var radio = document.querySelector('input[name="requirement"][value="' + value + '"]');
      if (radio) {
        radio.checked = true;
        clearError(radio.closest(".form__fieldset") || radio.closest(".form__field"), "requirement");
      }
    });
  });

  /* ---------- Enquiry form ---------- */
  var form = document.getElementById("enquiryForm");
  var successPanel = document.getElementById("formSuccess");
  var submitBtn = document.getElementById("submitBtn");

  function setError(field, id, message) {
    field.classList.add("has-error");
    var el = document.getElementById(id + "-error");
    if (el) el.textContent = message;
    var input = field.querySelector(".form__input");
    if (input) input.setAttribute("aria-invalid", "true");
  }

  function clearError(field, id) {
    if (!field) return;
    field.classList.remove("has-error");
    var el = document.getElementById(id + "-error");
    if (el) el.textContent = "";
    var input = field.querySelector(".form__input");
    if (input) input.removeAttribute("aria-invalid");
  }

  function fieldOf(input) { return input.closest(".form__field"); }

  var validators = {
    fullName: function (value) {
      if (!value.trim()) return "Please enter your name.";
      if (value.trim().length < 2) return "Name looks too short.";
      return "";
    },
    email: function (value) {
      if (!value.trim()) return "Please enter your email address.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())) return "Please enter a valid email address.";
      return "";
    },
    phone: function (value) {
      if (!value.trim()) return "Please enter your phone number.";
      var digits = value.replace(/\D/g, "");
      // national number only — the country code lives in its own select
      if (digits.length < 6 || digits.length > 14) return "Please enter a valid phone number.";
      return "";
    }
  };

  ["fullName", "email", "phone"].forEach(function (name) {
    var input = document.getElementById(name);
    input.addEventListener("blur", function () {
      var message = validators[name](input.value);
      if (message) setError(fieldOf(input), name, message);
    });
    input.addEventListener("input", function () {
      if (fieldOf(input).classList.contains("has-error") && !validators[name](input.value)) {
        clearError(fieldOf(input), name);
      }
    });
  });

  var requirementRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="requirement"]'));
  var requirementFieldset = document.querySelector(".form__fieldset");
  requirementRadios.forEach(function (radio) {
    radio.addEventListener("change", function () {
      clearError(requirementFieldset, "requirement");
    });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var firstInvalid = null;

    ["fullName", "email", "phone"].forEach(function (name) {
      var input = document.getElementById(name);
      var message = validators[name](input.value);
      if (message) {
        setError(fieldOf(input), name, message);
        if (!firstInvalid) firstInvalid = input;
      } else {
        clearError(fieldOf(input), name);
      }
    });

    var requirementChosen = requirementRadios.some(function (r) { return r.checked; });
    if (!requirementChosen) {
      requirementFieldset.classList.add("has-error");
      document.getElementById("requirement-error").textContent = "Please select Development or Marketing.";
      if (!firstInvalid) firstInvalid = requirementRadios[0];
    } else {
      clearError(requirementFieldset, "requirement");
    }

    if (firstInvalid) {
      firstInvalid.focus({ preventScroll: false });
      return;
    }

    var label = submitBtn.querySelector(".form__submit-label");
    var originalLabel = label.textContent;
    submitBtn.classList.add("is-loading");
    label.textContent = "Submitting…";
    submitBtn.setAttribute("aria-busy", "true");

    var payload = {};
    new FormData(form).forEach(function (value, key) { payload[key] = value; });

    fetch(form.getAttribute("action") || "/api/enquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          // surface server-side field errors next to the right inputs
          var serverErrors = (result.data && result.data.errors) || {};
          var firstField = null;
          Object.keys(serverErrors).forEach(function (name) {
            var input = document.getElementById(name);
            var field = input ? fieldOf(input) : requirementFieldset;
            if (field) {
              field.classList.add("has-error");
              var el = document.getElementById(name + "-error");
              if (el) el.textContent = serverErrors[name];
              if (!firstField) firstField = input || requirementRadios[0];
            }
          });
          throw new Error(
            (result.data && result.data.message) ||
            (firstField ? "Please check the highlighted fields." : "Submission failed.")
          );
        }
        form.hidden = true;
        successPanel.hidden = false;
        successPanel.focus();
      })
      .catch(function (err) {
        submitBtn.classList.remove("is-loading");
        submitBtn.removeAttribute("aria-busy");
        label.textContent = originalLabel;
        var box = document.getElementById("formStatus");
        if (box) {
          box.textContent = err.message === "Failed to fetch"
            ? "We couldn't reach the server. Please check your connection and try again."
            : err.message;
          box.hidden = false;
        }
      });
  });

  /* ---------- Side header (version B): offset page content ---------- */
  var sideHeader = document.querySelector(".header--side");
  if (sideHeader) document.body.classList.add("has-side-header");

  /* ---------- Scroll progress rail (version B) ---------- */
  var railFill = document.getElementById("railFill");
  if (railFill) {
    var railCurrent = document.getElementById("railCurrent");
    var railTotal = document.getElementById("railTotal");
    var railSections = Array.prototype.slice.call(document.querySelectorAll("main > section"));
    var sideMode = window.matchMedia("(min-width: 1025px)");
    var pad2 = function (n) { return (n < 10 ? "0" : "") + n; };
    railTotal.textContent = pad2(railSections.length);

    var updateRail = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var progress = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
      var pct = (progress * 100).toFixed(1) + "%";
      // horizontal fill inside the side bar, vertical otherwise
      if (sideHeader && sideMode.matches) {
        railFill.style.width = pct;
        railFill.style.height = "100%";
      } else {
        railFill.style.height = pct;
        railFill.style.width = "100%";
      }
      var probe = window.scrollY + window.innerHeight * 0.4;
      var idx = 0;
      railSections.forEach(function (s, i) {
        if (s.offsetTop <= probe) idx = i;
      });
      railCurrent.textContent = pad2(idx + 1);
    };
    window.addEventListener("scroll", updateRail, { passive: true });
    window.addEventListener("resize", updateRail);
    updateRail();
  }

  /* ---------- Eased in-page scrolling ----------
     Long, eased glide between sections so the paper stack reads as the
     page transforming in place rather than jumping. */
  function smoothScrollTo(targetY, duration) {
    var startY = window.scrollY;
    var delta = targetY - startY;
    if (prefersReducedMotion || Math.abs(delta) < 2) {
      window.scrollTo({ top: targetY, behavior: "instant" });
      return;
    }
    var start = null;
    function ease(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      window.scrollTo({ top: startY + delta * ease(p), behavior: "instant" });
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener("click", function (e) {
    var link = e.target.closest('a[href^="#"]');
    if (!link) return;
    var target = document.getElementById(link.getAttribute("href").slice(1));
    if (!target) return;
    e.preventDefault();
    var offset = document.body.classList.contains("has-side-header") && window.innerWidth >= 1025 ? 16 : 90;
    smoothScrollTo(Math.max(0, target.offsetTop - offset), 950);
    if (history.pushState) history.pushState(null, "", link.getAttribute("href"));
  });

  /* ---------- Footer year ---------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();

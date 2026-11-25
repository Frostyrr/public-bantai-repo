import React, { useState } from "react";
import { Mail, Send, CheckCircle2, Clock, Copy, Check } from "lucide-react";
import ScrollReveal from "../ui/ScrollReveal";
import Button from "../ui/Button";
import Select from "../ui/Select";
import TurnstileWidget from "../auth/TurnstileWidget";
import { submitInquiry, type InquiryPayload } from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";

export const ContactSection: React.FC = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [inquiryType, setInquiryType] = useState<"officer" | "treasurer" | "pricing" | "other">("officer");
  const [message, setMessage] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText("marcelson.rebato@gmail.com");
      setCopiedEmail(true);
      window.setTimeout(() => setCopiedEmail(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!name.trim() || !email.trim() || !message.trim()) {
      setSubmitError("Please complete all required inquiry fields.");
      return;
    }
    if (!captchaToken) {
      setSubmitError("Please complete the security verification before submitting.");
      return;
    }

    setSubmitError("");
    setIsSubmitting(true);
    try {
      await submitInquiry({
        name: name.trim(),
        email: email.trim(),
        orgName: orgName.trim() || undefined,
        inquiryType,
        message: message.trim(),
        captchaToken,
      });
      setIsSubmitted(true);
      setName("");
      setEmail("");
      setOrgName("");
      setMessage("");
    } catch (err) {
      setSubmitError(formatErrorMessage(err));
    } finally {
      setIsSubmitting(false);
      setCaptchaToken(null);
      setTurnstileResetSignal((s) => s + 1);
    }
  };

  return (
    <section
      id="contact"
      tabIndex={-1}
      className="py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto relative hardware-sharp"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
        {/* Left Column: Context & Direct Contact Info */}
        <ScrollReveal
          direction="up"
          distance={14}
          className="lg:col-span-5 space-y-8"
        >
          <div>
            <span className="page-header-eyebrow mb-4">Contact &amp; Support</span>
            <h2 className="text-3xl sm:text-4xl md:text-[42px] leading-[1.12] tracking-[-0.025em]">
              <span className="text-display-gradient">Get in touch with the Bantai team.</span>
            </h2>
            <p className="font-body font-normal text-secondary text-sm sm:text-base mt-4 leading-relaxed">
              Have questions about deploying Bantai in your student council,
              enterprise federation, or campus committee? Send us a message and
              we'll respond promptly.
            </p>
          </div>

          {/* Direct Contact & Response Cards */}
          <div className="space-y-3">
            <div className="card-specular p-5 flex items-start justify-between gap-3 transition-colors hover:border-strong">
              <div className="flex items-start gap-4 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center shrink-0 text-primary">
                  <Mail className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-muted mb-0.5">
                    Direct Email
                  </p>
                  <a
                    href="mailto:marcelson.rebato@gmail.com"
                    className="font-mono text-sm font-medium text-primary hover:text-secondary transition-colors break-all"
                  >
                    marcelson.rebato@gmail.com
                  </a>
                  <p className="text-xs text-secondary mt-1">
                    General support and onboarding inquiries
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyEmail}
                aria-label="Copy email address"
                title={copiedEmail ? "Copied!" : "Copy email address"}
                className="shrink-0 flex size-8 items-center justify-center rounded-lg border border-subtle bg-elevated text-secondary hover:border-strong hover:text-primary transition-colors cursor-pointer"
              >
                {copiedEmail ? (
                  <Check className="size-3.5 text-sem-success-fg" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
              </button>
            </div>

            <div className="card-specular p-5 flex items-start gap-4 transition-colors hover:border-strong">
              <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center shrink-0 text-primary">
                <Clock className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[11px] font-mono uppercase tracking-wider text-muted mb-0.5">
                  Response Time
                </p>
                <p className="text-sm font-medium text-primary">
                  Within 24 hours
                </p>
                <p className="text-xs text-secondary mt-1">
                  For student orgs, nonprofits, and workspace setup
                </p>
              </div>
            </div>
          </div>
        </ScrollReveal>

        {/* Right Column: Interactive Contact Form */}
        <ScrollReveal
          direction="up"
          distance={14}
          delay={100}
          className="lg:col-span-7"
        >
          <div className="card-specular rounded-3xl p-6 sm:p-10 shadow-xl hardware-sharp">
            {isSubmitted ? (
              <div className="animate-insight-swap py-12 px-4 text-center flex flex-col items-center">
                <div className="w-14 h-14 rounded-2xl bg-sem-success-bg border border-sem-success-border flex items-center justify-center mb-4 text-sem-success-fg">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h3 className="font-heading font-medium text-2xl text-primary mb-2 tracking-tight">
                  Message Sent Successfully!
                </h3>
                <p className="font-body font-normal text-secondary text-sm max-w-md leading-relaxed mb-6">
                  Thank you for reaching out. We have received your inquiry and
                  our team will get back to your email within 24 hours.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setIsSubmitted(false);
                    setSubmitError("");
                    setCaptchaToken(null);
                    setTurnstileResetSignal((s) => s + 1);
                  }}
                  className="rounded-full px-6 py-2.5 text-xs font-mono"
                >
                  Send another message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="contact-name"
                      className="block text-xs font-mono text-secondary mb-2"
                    >
                      Your Full Name <span className="text-sem-error-fg">*</span>
                    </label>
                    <input
                      id="contact-name"
                      type="text"
                      required
                      placeholder="e.g. Maria Santos"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="contact-email"
                      className="block text-xs font-mono text-secondary mb-2"
                    >
                      Email Address <span className="text-sem-error-fg">*</span>
                    </label>
                    <input
                      id="contact-email"
                      type="email"
                      required
                      placeholder="e.g. maria@university.edu.ph"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="contact-org"
                      className="block text-xs font-mono text-secondary mb-2"
                    >
                      Organization / School Name
                    </label>
                    <input
                      id="contact-org"
                      type="text"
                      placeholder="e.g. Supreme Student Council"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="w-full bg-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors"
                    />
                  </div>

                  <div>
                    <Select
                      id="contact-type"
                      label="Inquiry Category"
                      value={inquiryType}
                      onChange={(e) => setInquiryType(e.target.value as InquiryPayload["inquiryType"])}
                      selectSize="md"
                      options={[
                        {
                          value: "officer",
                          label: "Student Organization Officer",
                        },
                        {
                          value: "admin",
                          label: "School Administration / Adviser",
                        },
                        {
                          value: "community",
                          label: "Non-Profit / Community Group",
                        },
                        {
                          value: "pricing",
                          label: "Pro Subscription & AI Tier",
                        },
                        { value: "other", label: "General Feedback / Other" },
                      ]}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="contact-message"
                    className="block text-xs font-mono text-secondary mb-2"
                  >
                    How can we help? <span className="text-sem-error-fg">*</span>
                  </label>
                  <textarea
                    id="contact-message"
                    required
                    rows={4}
                    placeholder="Tell us about your organization's needs, questions about features, or subscription inquiries…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full bg-elevated border border-subtle rounded-2xl p-4 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors resize-none"
                  />
                </div>

                <TurnstileWidget
                  action="contact_inquiry"
                  resetSignal={turnstileResetSignal}
                  disabled={isSubmitting}
                  onTokenChange={setCaptchaToken}
                />

                {submitError && (
                  <p role="alert" className="text-xs text-sem-error-fg">
                    {submitError}
                  </p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  disabled={isSubmitting || !captchaToken}
                  iconRight={
                    isSubmitting ? undefined : (
                      <Send className="w-4 h-4" />
                    )
                  }
                  className="w-full rounded-2xl py-3.5 text-sm font-medium bg-action hover:opacity-90 text-action-fg shadow-lg transition-all cursor-pointer justify-center"
                >
                  {isSubmitting ? "Sending Message…" : "Submit Inquiry"}
                </Button>
              </form>
            )}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
};

export default ContactSection;

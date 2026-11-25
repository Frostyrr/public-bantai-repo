import { Navigate } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import { extractApiErrorDetails } from "../../config/sessionRecovery";
import { getLoginRestriction } from "../../config/loginRestriction";
import WorkspaceBootScreen from "../../components/layout/WorkspaceBootScreen";
import RimDivider from '../../components/ui/RimDivider';
import Governance from '../../components/home/Governance';
import ScrollReveal from '../../components/ui/ScrollReveal';
import { EditorialLink } from "../../components/layout/EditorialPage";
import React from 'react';
import Navbar from '../../components/layout/Navbar';
import Hero from '../../components/home/Hero';
import Features from '../../components/home/Features';
import BaniIntro from '../../components/home/BaniIntro';
import HomePlans from '../../components/home/HomePlans';
import HomeFaq from '../../components/home/HomeFaq';
import AccountabilityLifecycle from '../../components/home/AccountabilityLifecycle';
import ContactSection from '../../components/home/ContactSection';
import CallToAction from '../../components/home/CallToAction';
import Footer from '../../components/layout/Footer';

export const Home: React.FC = () => {
  const { user, isPending, error } = useAuth();

  if (error) {
    const details = extractApiErrorDetails(error);
    if (details.code === "mfa_required") return <Navigate to="/dashboard" replace />;
    return <Navigate to="/login" replace state={{
      restriction: getLoginRestriction(details), sessionError: details.message,
    }} />;
  }

  // Resolve the session before showing the public homepage to avoid a signed-in flash.
  if (isPending) {
    return (
      <WorkspaceBootScreen
        mode="session"
        ariaLabel="Checking sign-in status"
      />
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas isolate text-primary flex flex-col font-body font-normal relative">
      <Navbar />

      {/* Main Sections */}
      <main className="flex-1 flex flex-col relative z-10">
        <Hero />
        <RimDivider />
        <Features />
        <RimDivider />
        <BaniIntro />
        <RimDivider />
        <Governance />
        <RimDivider />
        <AccountabilityLifecycle />
        <ScrollReveal className="mx-auto px-6 pb-10 text-sm text-secondary"><EditorialLink to="/story">Discover why we built Bantai</EditorialLink></ScrollReveal>
        <RimDivider />
        <HomePlans />
        <RimDivider />
        <HomeFaq />
        <RimDivider />
        <ContactSection />
        <RimDivider />
        <CallToAction />
      </main>

      {/* Footer */}
      <div className="mt-20">
        <Footer />
      </div>
    </div>
  );
};

export default Home;

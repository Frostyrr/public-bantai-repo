import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import { Analytics } from "@vercel/analytics/react";
import { Route, Routes, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { getLoginRestriction, LOGIN_RESTRICTION_EVENT } from "./config/loginRestriction";
import { useTheme } from "./context/ThemeContext";
import PageScroll from './components/layout/PageScroll'
import CanvasTexture from './components/layout/CanvasTexture'

const AuthListener = lazy(() => import("./components/auth/AuthListener"));

const OrgSpaceDetail = lazy(() => import("./pages/org/OrgSpaceDetail"));
const NotFound = lazy(() => import("./pages/public/NotFound"));
const Home = lazy(() => import("./pages/public/Home"));
const Login = lazy(() => import("./pages/auth/Login"));
const ForgetPassword = lazy(() => import("./pages/auth/ForgetPassword"));
const Register = lazy(() => import("./pages/auth/Register"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));
const About = lazy(() => import("./pages/public/About"));
const Contact = lazy(() => import("./pages/public/Contact"));
const TermsOfService = lazy(() => import("./pages/public/TermsOfService"));
const PrivacyPolicy = lazy(() => import("./pages/public/PrivacyPolicy"));
const VerifyEmail = lazy(() => import("./pages/auth/VerifyEmail"));
const VerifyEmailPrompt = lazy(() => import("./pages/auth/VerifyEmailPrompt"));
const PersonalWorkspaceLayout = lazy(() => import("./components/layout/PersonalWorkspaceLayout"));
const Dashboard = lazy(() => import("./pages/app/Dashboard"));
const AppContainer = lazy(() => import("./components/layout/AppContainer"));
const AuthCallback = lazy(() => import("./pages/auth/AuthCallback"));
const OrganizationLayout = lazy(() => import("./components/layout/OrganizationLayout"));
const OrgOverview = lazy(() => import("./pages/org/OrgOverview"));
const OrgSpaces = lazy(() => import("./pages/org/OrgSpaces"));
const OrgMembers = lazy(() => import("./pages/org/OrgMembers"));
const OrgDirectory = lazy(() => import("./pages/org/OrgDirectory"));
const OrgMyContributions = lazy(() => import("./pages/org/OrgMyContributions"));
const OrgSettings = lazy(() => import("./pages/org/OrgSettings"));
const OrgMyProfile = lazy(() => import("./pages/org/OrgMyProfile"));
const OrgArchives = lazy(() => import("./pages/org/OrgArchives"));
const OrgCollections = lazy(() => import("./pages/org/OrgCollections"));
const OrgCollectionDetail = lazy(() => import("./pages/org/OrgCollectionDetail"));
const PersonalPayments = lazy(() => import("./pages/app/PersonalPayments"));
const OrgBudgets = lazy(() => import("./pages/org/OrgBudgets"));
const OrgExpenses = lazy(() => import("./pages/org/OrgExpenses"));
const OrgApprovals = lazy(() => import("./pages/org/OrgApprovals"));
const OrgReimbursements = lazy(() => import("./pages/org/OrgReimbursements"));
const OrgLiquidation = lazy(() => import("./pages/org/OrgLiquidation"));
const OrgReports = lazy(() => import("./pages/org/OrgReports"));
const OrgAuditLogs = lazy(() => import("./pages/org/OrgAuditLogs"));
const AccountSettings = lazy(() => import("./pages/app/AccountSettings"));
const AdminDashboard = lazy(() => import("./pages/app/AdminDashboard"));

function App() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const handleRestriction = (event: Event) => {
      if (!(pathname === "/dashboard" || pathname === "/admin" || pathname === "/app" || pathname.startsWith("/app/"))) return;
      const restriction = getLoginRestriction((event as CustomEvent).detail);
      if (restriction) navigate("/login", { replace: true, state: { restriction } });
    };
    window.addEventListener(LOGIN_RESTRICTION_EVENT, handleRestriction);
    return () => window.removeEventListener(LOGIN_RESTRICTION_EVENT, handleRestriction);
  }, [navigate, pathname]);
  const { resolvedTheme } = useTheme();
  const isWorkspaceRoute =
    pathname === "/dashboard" || pathname === "/app" || pathname.startsWith("/app/");
  const isThemeAwareRoute =
    isWorkspaceRoute ||
    pathname === "/" ||
    pathname === "/about" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/verify-email" ||
    pathname.startsWith("/email/verify") ||
    pathname.startsWith("/password/") ||
    pathname === "/auth/callback" ||
    pathname === "/terms" ||
    pathname === "/terms-of-service" ||
    pathname === "/privacy" ||
    pathname === "/privacy-policy" ||
    pathname === "/contact";

  useLayoutEffect(() => {
    const isDark = isThemeAwareRoute ? resolvedTheme === "dark" : true;
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, [isThemeAwareRoute, resolvedTheme]);

  return (
    <>
      <Analytics />
      <CanvasTexture />
      <Suspense fallback={null}>
        <AuthListener />
      </Suspense>
      <PageScroll />
      <Suspense fallback={<div role="status" className="min-h-dvh workspace-canvas">
        <span className="sr-only">Loading page</span>
        <div aria-hidden="true" className="relative h-0.5 overflow-hidden bg-subtle">
          <div className="animate-loading-bar bg-action" />
        </div>
      </div>}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          {/* Public Pages */}
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/terms-of-service" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmailPrompt />} />
          <Route path="/email/verify" element={<VerifyEmailPrompt />} />
          <Route path="/email/verify/:code" element={<VerifyEmail />} />
          <Route path="/password/forgot" element={<ForgetPassword />} />
          <Route path="/password/reset" element={<ResetPassword />} />

          {/* Protected Authenticated Workspaces */}
          <Route element={<AppContainer />}>
            {/* Personal Workspace */}
            <Route element={<PersonalWorkspaceLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/app" element={<Dashboard />} />
              <Route path="/app/organizations" element={<Dashboard />} />
              <Route path="/app/payments" element={<PersonalPayments />} />
              <Route path="/app/settings" element={<AccountSettings />} />
            </Route>
            <Route path="/admin" element={<AdminDashboard />} />

            {/* Organization Scoped Workspace */}
            <Route path="/app/org/:orgId" element={<OrganizationLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<OrgOverview />} />
              <Route path="contributions" element={<OrgMyContributions />} />
              <Route path="spaces" element={<OrgSpaces />} />
              <Route path="spaces/:spaceId" element={<OrgSpaceDetail />} />
              <Route path="members" element={<OrgMembers />} />
              <Route path="directory" element={<OrgDirectory />} />
              <Route path="settings" element={<OrgSettings />} />
              <Route path="my-profile" element={<OrgMyProfile />} />
              <Route path="collections" element={<OrgCollections />} />
              <Route path="collections/:collectionId" element={<OrgCollectionDetail />} />
              <Route path="budgets" element={<OrgBudgets />} />
              <Route path="expenses" element={<OrgExpenses />} />
              <Route path="approvals" element={<OrgApprovals />} />
              <Route path="reimbursements" element={<OrgReimbursements />} />
              <Route path="liquidation" element={<OrgLiquidation />} />
              <Route path="reports" element={<OrgReports />} />
              <Route path="archives" element={<OrgArchives />} />
              <Route path="audit-logs" element={<OrgAuditLogs />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  )
}

export default App

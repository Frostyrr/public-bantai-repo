import useFinancialQuery from "../../hooks/useFinancialQuery";
import CompactAmount from "../../components/ui/CompactAmount";
import Badge from "../../components/ui/Badge";
import Select from "../../components/ui/Select";
import OverviewCrop from "../../components/dashboard/OverviewCrop";
import {
  canReviewExpense,
  canReviewAdvance,
  canReviewFinances,
} from "../../utils/financialWorkflow";
import QuerySection from "../../components/layout/QuerySection";
import { useState, useRef, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PieChart,
  ChevronDown,
  Pencil,
  ArrowRight,
  TrendingUp,
  FileCheck,
  CreditCard,
  AlertCircle,
  Copy,
  Check,
  Wallet,
  Palette,
  Image as ImageIcon,
  X,
  UploadCloud,
  FileImage,
  AlertTriangle,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import OperationalWidgets from "../../components/dashboard/OperationalWidgets";
import FinancialActivityFeed from "../../components/dashboard/FinancialActivityFeed";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Modal from "../../components/ui/Modal";
import {
  updateOrganizationLogo,
  updateOrganizationCover,
  updateOrganization,
  type OrganizationDetails,
  type Membership,
} from "../../lib/api";
import { compressImageFile } from "../../utils/compressImage";

interface ContextType {
  insightsStrip?: React.ReactNode;
  organization: OrganizationDetails;
  membership: Membership;
  activePeriodId: string;
}

interface CoverTheme {
  id: string;
  name: string;
  gradient: string;
  ambientGlow: string;
  ambientGlow2: string;
  avatarBg: string;
  previewBg: string;
}

const COVER_THEMES: CoverTheme[] = [
  {
    id: "obsidian",
    name: "Obsidian Monochrome",
    gradient: "from-zinc-900 via-neutral-900 to-zinc-950",
    ambientGlow: "bg-white/5",
    ambientGlow2: "bg-zinc-600/10",
    avatarBg: "bg-zinc-900 text-white border border-zinc-700",
    previewBg: "bg-zinc-800",
  },
  {
    id: "emerald",
    name: "Emerald Reserve",
    gradient: "from-emerald-950 via-teal-950/70 to-zinc-950",
    ambientGlow: "bg-emerald-500/20",
    ambientGlow2: "bg-zinc-900/60",
    avatarBg: "bg-gradient-to-br from-emerald-600 to-teal-800 text-emerald-100",
    previewBg: "bg-emerald-600",
  },
  {
    id: "sapphire",
    name: "Sapphire Trust",
    gradient: "from-blue-950 via-indigo-950/70 to-zinc-950",
    ambientGlow: "bg-zinc-900/60",
    ambientGlow2: "bg-zinc-900/60",
    avatarBg: "bg-gradient-to-br from-blue-600 to-indigo-800 text-zinc-400",
    previewBg: "bg-zinc-900/60",
  },
  {
    id: "violet",
    name: "Obsidian Violet",
    gradient: "from-purple-950 via-violet-950/70 to-zinc-950",
    ambientGlow: "bg-zinc-900/60",
    ambientGlow2: "bg-zinc-900/60",
    avatarBg: "bg-gradient-to-br from-purple-600 to-violet-800 text-zinc-400",
    previewBg: "bg-zinc-900/60",
  },
  {
    id: "amber",
    name: "Sunset Vault",
    gradient: "from-amber-950 via-orange-950/70 to-zinc-950",
    ambientGlow: "bg-amber-500/20",
    ambientGlow2: "bg-zinc-900/60",
    avatarBg: "bg-gradient-to-br from-amber-600 to-orange-800 text-amber-100",
    previewBg: "bg-amber-600",
  },
  {
    id: "rose",
    name: "Rose Quartz",
    gradient: "from-rose-950 via-pink-950/70 to-zinc-950",
    ambientGlow: "bg-rose-500/20",
    ambientGlow2: "bg-pink-500/20",
    avatarBg: "bg-gradient-to-br from-rose-600 to-pink-800 text-rose-100",
    previewBg: "bg-rose-600",
  },
  {
    id: "slate",
    name: "Cyber Slate",
    gradient: "from-zinc-900 via-neutral-900 to-zinc-950",
    ambientGlow: "bg-zinc-400/10",
    ambientGlow2: "bg-zinc-600/10",
    avatarBg: "bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-100",
    previewBg: "bg-zinc-700",
  },
];

function getDeterministicTheme(orgName = ""): CoverTheme {
  let hash = 0;
  for (let i = 0; i < orgName.length; i++) {
    hash = (hash << 5) - hash + orgName.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % COVER_THEMES.length;
  return COVER_THEMES[index];
}

function getInitials(name = "") {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "OR";
}

function overviewAmount(centavos: number, currency: string) {
  return <CompactAmount centavos={centavos} currency={currency} animate />;
}

function overviewFullAmount(centavos: number, currency: string) {
  return <CompactAmount centavos={centavos} currency={currency} animate />;
}

export default function OrgOverview() {
  const { organization, membership, activePeriodId, insightsStrip } =
    useOutletContext<ContextType>();
  const queryClient = useQueryClient();
  const currency = organization?.currency ?? "PHP";
  const orgId = organization?.id;

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardPromptRef = useRef<HTMLElement>(null);
  const editorDismissFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!confirmDiscard) return;
    discardPromptRef.current?.querySelector("button")?.focus();
  }, [confirmDiscard]);

  const [editorNotice, setEditorNotice] = useState("");
  const editorTabs = ["Details", "Cover", "Logo"] as const;
  const [editorTab, setEditorTab] = useState<
    (typeof editorTabs)[number] | null
  >(null);
  const detailsOpen = editorTab === "Details";
  const coverOpen = editorTab === "Cover";
  const logoOpen = editorTab === "Logo";
  const [profileName, setProfileName] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (!editorNotice) return;
    const timeout = window.setTimeout(() => setEditorNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [editorNotice]);

  const canEditProfile =
    membership.role === "owner" || membership.role === "organization_admin";
  const saveProfile = useMutation({
    mutationFn: () =>
      updateOrganization(orgId, { name: profileName.trim(), description }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      setEditorNotice("Organization details saved.");
      setEditorTab(null);
    },
  });
  const openEditor = () => {
    saveProfile.reset();
    setProfileName(organization.name);
    setDescription(organization.description ?? "");
    setEditorNotice("");
    setImageUrlInput(customImageUrl);
    setDraftTheme(customImageUrl ? "" : activeTheme.id);
    setCoverTab("upload");
    setCoverSaveError("");
    setUploadError("");
    setPreviewImage(null);
    setCoverSource(null);
    setImageMeta(null);
    setLogoPreview(null);
    setLogoSource(null);
    setLogoMeta(null);
    setLogoUploadError("");
    setEditorTab("Details");
  };
  const coverRef = useRef<HTMLDivElement>(null);
  const [coverRatio, setCoverRatio] = useState(4);
  useEffect(() => {
    const cover = coverRef.current;
    if (!cover) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setCoverRatio(width / height);
    });
    observer.observe(cover);
    return () => observer.disconnect();
  }, []);
  const [overviewSection, setOverviewSection] = useState<
    "activity" | "collections" | "advances" | "budgets" | "reviews"
  >("activity");
  const sections = [
    ["activity", "Financial Activity"],
    ["collections", "Collections & Dues"],
    ["advances", "Cash Advances"],
    ["budgets", "Budget Utilization"],
    ["reviews", "Review Queue"],
  ] as const;
  const [copiedCode, setCopiedCode] = useState(false);
  const summaryPreference = `bantai_summary_hidden_${membership.profile_id || "user"}_${orgId}`;
  const [hiddenSummaryKey, setHiddenSummaryKey] = useState<string | null>(null);
  const summaryVisible = hiddenSummaryKey !== summaryPreference;
  const toggleSummary = () => {
    const hidden = summaryVisible;
    setHiddenSummaryKey(hidden ? summaryPreference : null);
    try {
      localStorage.setItem(summaryPreference, String(hidden));
    } catch {
      /* Storage may be unavailable. */
    }
  };

  const coverPreference = `bantai_cover_hidden_${membership.profile_id || "user"}_${orgId}`;
  const mobileCoverPreference = `bantai_cover_mobile_visible_${membership.profile_id || "user"}_${orgId}`;
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (event: MediaQueryListEvent) => setIsMobileViewport(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const [hiddenCoverKey, setHiddenCoverKey] = useState(() => {
    try {
      return localStorage.getItem(coverPreference) === "true" ? coverPreference : null;
    } catch {
      return null;
    }
  });
  const [mobileCoverVisibleKey, setMobileCoverVisibleKey] = useState(() => {
    try {
      return localStorage.getItem(mobileCoverPreference) === "true" ? mobileCoverPreference : null;
    } catch {
      return null;
    }
  });

  const coverVisible = isMobileViewport
    ? mobileCoverVisibleKey === mobileCoverPreference
    : hiddenCoverKey !== coverPreference;

  const toggleCover = () => {
    if (isMobileViewport) {
      const nextVisible = mobileCoverVisibleKey !== mobileCoverPreference;
      setMobileCoverVisibleKey(nextVisible ? mobileCoverPreference : null);
      try {
        localStorage.setItem(mobileCoverPreference, String(nextVisible));
      } catch {
        /* Storage may be unavailable. */
      }
      return;
    }
    const hidden = coverVisible;
    setHiddenCoverKey(hidden ? coverPreference : null);
    try {
      localStorage.setItem(coverPreference, String(hidden));
    } catch {
      /* Storage may be unavailable. */
    }
  };

  // Logo customizer state
  const logoStorageKey = `bantai_logo_${orgId}`;
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const customLogoUrl = logoLoadFailed
    ? ""
    : organization?.logo_url !== undefined
      ? organization.logo_url || ""
      : localStorage.getItem(logoStorageKey) || "";
  const [logoSource, setLogoSource] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoMeta, setLogoMeta] = useState<{
    name: string;
    size: string;
    dimensions: string;
  } | null>(null);
  const [logoUploadError, setLogoUploadError] = useState("");
  const [isLogoDragging, setIsLogoDragging] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  const updateLogoMutation = useMutation({
    mutationFn: (logoUrl: string | null) =>
      updateOrganizationLogo(orgId, logoUrl),
    onSuccess: (_, logoUrl) => {
      setLogoLoadFailed(false);
      try {
        if (logoUrl) localStorage.setItem(logoStorageKey, logoUrl);
        else localStorage.removeItem(logoStorageKey);
      } catch {
        /* The server remains the source of truth. */
      }
      window.dispatchEvent(new Event("bantai_logo_updated"));
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
      setEditorNotice(
        logoUrl ? "Organization logo saved." : "Organization logo removed.",
      );
      setEditorTab(null);
      setLogoPreview(null);
      setLogoSource(null);
      setLogoMeta(null);
    },
    onError: (error) => setLogoUploadError(error.message),
  });

  const handleLogoFileProcess = (file: File) => {
    setLogoUploadError("");

    // 1. MIME Validation
    const validMimes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/svg+xml",
    ];
    if (!validMimes.includes(file.type)) {
      setLogoUploadError(
        "Invalid format. Please upload a PNG, JPG, WebP, or SVG logo.",
      );
      return;
    }

    // 2. File Size Validation (Max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setLogoUploadError(
        `Logo file size (${sizeMb} MB) exceeds the 5 MB maximum limit.`,
      );
      return;
    }

    // 3. Image Integrity & Square Crop Canvas Processing
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      if (img.naturalWidth < 64 || img.naturalHeight < 64) {
        setLogoUploadError(
          `Resolution too small (${img.naturalWidth} × ${img.naturalHeight}px). Recommended minimum is 128 × 128px.`,
        );
        return;
      }

      // Square canvas processing: center crop to 512x512 square
      const canvas = document.createElement("canvas");
      const size = 512;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setLogoUploadError("Could not process logo graphics buffer.");
        return;
      }

      const minDim = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - minDim) / 2;
      const sy = (img.naturalHeight - minDim) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

      const processedDataUrl = canvas.toDataURL("image/webp", 0.9);
      setLogoPreview(processedDataUrl);
      const reader = new FileReader();
      reader.onload = () =>
        setLogoSource(typeof reader.result === "string" ? reader.result : null);
      reader.readAsDataURL(file);
      setLogoMeta({
        name: file.name,
        size: `${(file.size / 1024).toFixed(0)} KB`,
        dimensions: `${img.naturalWidth} × ${img.naturalHeight} px (Square 512×512)`,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setLogoUploadError(
        "Could not decode image file. The file may be corrupt.",
      );
    };

    img.src = objectUrl;
  };

  const handleSaveLogo = () => {
    if (!logoPreview) {
      setLogoUploadError("Please select or drop a logo first.");
      return;
    }
    if (!updateLogoMutation.isPending) updateLogoMutation.mutate(logoPreview);
  };

  const handleRemoveLogo = () => {
    if (!updateLogoMutation.isPending) updateLogoMutation.mutate(null);
  };

  // Cover customizer state
  const storageKey = `bantai_cover_${orgId}`;
  const rawCoverUrl =
    organization?.cover_image_url !== undefined
      ? organization.cover_image_url || ""
      : localStorage.getItem(`${storageKey}_image`) || "";
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const coverLoadFailed = Boolean(rawCoverUrl) && failedCoverUrl === rawCoverUrl;
  const selectedThemeId =
    organization?.cover_theme !== undefined
      ? organization.cover_theme || ""
      : localStorage.getItem(`${storageKey}_theme`) || "";
  const customImageUrl = coverLoadFailed ? "" : rawCoverUrl;
  const [imageUrlInput, setImageUrlInput] = useState(customImageUrl);

  const isOfficer =
    membership?.role === "owner" ||
    membership?.role === "organization_admin" ||
    membership?.role === "treasurer" ||
    membership?.role === "auditor";

  // Upload & Drag/Drop state
  const [coverTab, setCoverTab] = useState<"upload" | "presets" | "url">(
    "upload",
  );
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [coverSource, setCoverSource] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{
    name: string;
    size: string;
    dimensions: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileProcess = (file: File) => {
    setUploadError("");

    // 1. MIME Validation
    const validMimes = ["image/jpeg", "image/png", "image/webp"];
    if (!validMimes.includes(file.type)) {
      setUploadError(
        "Invalid image type. Please upload a JPG, PNG, or WebP photo.",
      );
      return;
    }

    // 2. File Size Validation (Max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setUploadError(
        `Image size (${sizeMb} MB) exceeds the 5 MB maximum limit.`,
      );
      return;
    }

    // 3. Compress & validate dimensions so payload stays safely within API limits
    void compressImageFile(file, {
      maxDimension: 1600,
      maxLength: 460_000,
      minWidth: 400,
      minHeight: 150,
    })
      .then(({ dataUrl, width, height }) => {
        setCoverSource(dataUrl);
        setPreviewImage(dataUrl);
        setImageMeta({
          name: file.name,
          size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
          dimensions: `${width} × ${height} px`,
        });
      })
      .catch((err: unknown) => {
        setUploadError(
          err instanceof Error ? err.message : "Could not decode image file. The file may be corrupt.",
        );
      });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileProcess(e.target.files[0]);
    }
  };

  const handleSaveUploadedImage = () => {
    if (!previewImage) {
      setUploadError("Please select or drop an image first.");
      return;
    }
    saveCover(previewImage, "");
  };

  const periodId = activePeriodId === "all" ? undefined : activePeriodId;
  const summaryQuery = useFinancialQuery("financial-summary", orgId);
  const periodSummary = useFinancialQuery("financial-summary", orgId, { periodId }, !!periodId);
  const expenditureQuery = periodId ? periodSummary : summaryQuery;
  const collectionsQuery = useFinancialQuery("collections", orgId, { periodId });
  const budgetsQuery = useFinancialQuery("budgets", orgId, { periodId });
  const expensesQuery = useFinancialQuery("expenses", orgId, { periodId });
  const advancesQuery = useFinancialQuery("advances", orgId);
  const allTimeExpenses = useFinancialQuery("expenses", orgId, {}, !!periodId && canReviewFinances(membership.role));
  const reviewExpensesQuery = periodId ? allTimeExpenses : expensesQuery;

  const summary = summaryQuery.data;
  const collections = collectionsQuery.data ?? [];
  const budgets = budgetsQuery.data ?? [];
  const expenses = expensesQuery.data ?? [];
  const advances = advancesQuery.data ?? [];

  // Theme resolution
  const defaultTheme = getDeterministicTheme(organization?.name);
  const activeTheme =
    COVER_THEMES.find((t) => t.id === selectedThemeId) || defaultTheme;

  // Computed metrics
  const activeCollections = collections.filter((c) => c.status === "active");
  const pendingExpenses = (reviewExpensesQuery.data ?? []).filter((e) =>
    canReviewExpense(e, membership.profile_id, membership.role),
  );
  const pendingAdvances = advances.filter((a) =>
    ["outstanding", "under_review", "disputed"].includes(a.status),
  );
  const openAdvancesLabel = advancesQuery.data !== undefined
    ? `${pendingAdvances.length} open ${pendingAdvances.length === 1 ? "advance" : "advances"}`
    : advancesQuery.isPending ? "Loading open advances…" : "Open advances unavailable";
  const totalPendingApprovals =
    pendingExpenses.length +
    advances.filter((a) =>
      canReviewAdvance(a, membership.profile_id, membership.role),
    ).length;

  const activeBudgets = budgets.filter((b) => b.status === "active");
  const totalBudgetAllocated = activeBudgets.reduce(
    (sum, b) => sum + b.allocated_amount_centavos,
    0,
  );
  const totalBudgetSpent = activeBudgets.reduce(
    (sum, b) => sum + (b.spent_centavos ?? 0),
    0,
  );
  const budgetUtilPct =
    totalBudgetAllocated > 0
      ? Math.min(100, Math.round((totalBudgetSpent / totalBudgetAllocated) * 100))
      : 0;
  const totalCollected = collections.reduce(
    (sum, c) => sum + (c.total_collected_centavos ?? 0),
    0,
  );
  const totalApprovedExpenses = expenditureQuery.data?.total_expenses_centavos ?? 0;

  const handleCopyInvite = () => {
    if (!organization.invite_code) return;
    navigator.clipboard.writeText(organization.invite_code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const [draftTheme, setDraftTheme] = useState("");
  const [coverSaveError, setCoverSaveError] = useState("");
  const updateCoverMutation = useMutation({
    mutationFn: ({ image, theme }: { image: string; theme: string }) =>
      updateOrganizationCover(orgId, {
        coverImageUrl: image || null,
        coverTheme: theme || null,
      }),
    onSuccess: (_, { image, theme }) => {
      try {
        if (image) localStorage.setItem(storageKey + "_image", image);
        else localStorage.removeItem(storageKey + "_image");
        if (theme) localStorage.setItem(storageKey + "_theme", theme);
        else localStorage.removeItem(storageKey + "_theme");
      } catch {
        /* Server remains source of truth. */
      }
      setFailedCoverUrl(null);
      setImageUrlInput(image);
      setCoverSaveError("");
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
      void queryClient.invalidateQueries({ queryKey: ["organization", orgId] });
      setEditorNotice("Organization cover saved.");
      setEditorTab(null);
    },
    onError: (error) => {
      setCoverSaveError(error.message || "Could not save organization cover.");
    },
  });
  const editorSaving = saveProfile.isPending || updateLogoMutation.isPending || updateCoverMutation.isPending;
  const trimmedName = profileName.trim();
  const detailsChanged =
    profileName !== organization.name ||
    description !== (organization.description ?? "");
  const canSaveDetails =
    Boolean(trimmedName) &&
    trimmedName.length <= 150 &&
    description.length <= 300 &&
    (trimmedName !== organization.name ||
      description !== (organization.description ?? ""));
  const hasEditorChanges =
    detailsChanged ||
    Boolean(previewImage || logoPreview) ||
    imageUrlInput !== customImageUrl ||
    draftTheme !== (customImageUrl ? "" : activeTheme.id);

  const keepEditing = () => {
    setConfirmDiscard(false);
    requestAnimationFrame(() => editorDismissFocus.current?.focus());
  };

  const closeEditor = () => {
    if (editorSaving) return;
    if (confirmDiscard) {
      keepEditing();
    } else if (hasEditorChanges) {
      editorDismissFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setConfirmDiscard(true);
    } else {
      setEditorTab(null);
    }
  };

  const saveCover = (image: string, theme: string) => {
    if (updateCoverMutation.isPending) return;
    setCoverSaveError("");
    updateCoverMutation.mutate({ image, theme });
  };

  const handleSaveCustomImage = () => {
    const image = imageUrlInput.trim();
    saveCover(image, image ? "" : selectedThemeId);
  };

  const handleResetToDefault = () => saveCover("", "");

  return (
    <div className="page-shell workspace-page">
      <p
        role="status"
        className={
          editorNotice
            ? "fixed bottom-4 right-4 z-50 max-w-[calc(100%-2rem)] rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-emerald-400 shadow-lg"
            : "sr-only"
        }
      >
        {editorNotice}
      </p>
      {/* OFFICER ATTENTION ALERT (If there are items awaiting review) */}
      {isOfficer && reviewExpensesQuery.data !== undefined && advancesQuery.data !== undefined && totalPendingApprovals > 0 && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 backdrop-blur-md">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-heading font-medium text-amber-950 dark:text-amber-200">
                Your reviews · all periods ({totalPendingApprovals})
              </h4>
              <p className="text-xs text-amber-800 dark:text-amber-400/80 mt-0.5">
                {pendingExpenses.length} expense(s) and{" "}
                {
                  advances.filter((a) =>
                    canReviewAdvance(a, membership.profile_id, membership.role),
                  ).length
                }{" "}
                liquidation(s) awaiting verification or sign-off.
              </p>
            </div>
          </div>

          <Button
            variant="primary"
            size="sm"
            to={`/app/org/${orgId}/approvals`}
            iconRight={<ArrowRight className="w-3.5 h-3.5" />}
            className="shrink-0 text-xs"
          >
            Review in Approvals Inbox
          </Button>
        </div>
      )}

      {/* WORKSPACE HERO COVER BANNER */}
      <div className="card-specular lg:z-30">
        {/* Collapsible Cover Artwork Container */}
        <div
          aria-hidden={!coverVisible}
          className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out motion-reduce:transition-none ${
            coverVisible
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0 pointer-events-none"
          }`}
        >
          <div className="overflow-hidden">
            <div
              ref={coverRef}
              className="relative h-[150px] w-full overflow-hidden md:h-[180px] xl:h-[210px]"
            >
              {customImageUrl ? (
                <img
                  src={customImageUrl}
                  alt={`${organization?.name} Cover`}
                  className="w-full h-full object-cover"
                  onError={() => {
                    // If custom image fails to load, gracefully fall back
                    setFailedCoverUrl(customImageUrl || null);
                  }}
                />
              ) : (
                <div
                  className={`w-full h-full bg-gradient-to-r ${activeTheme.gradient} relative`}
                >
                  {/* Subtle ambient light orbs and geometric accents */}
                  <div className="absolute inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:20px_20px] opacity-60" />
                  <div
                    className={`absolute -top-24 -right-16 w-80 h-80 rounded-full ${activeTheme.ambientGlow} blur-3xl`}
                  />
                  <div
                    className={`absolute -bottom-20 -left-16 w-72 h-72 rounded-full ${activeTheme.ambientGlow2} blur-2xl`}
                  />
                </div>
              )}

              {canEditProfile && (
                <button
                  type="button"
                  aria-label="Edit organization"
                  title="Edit organization"
                  onClick={openEditor}
                  tabIndex={coverVisible ? 0 : -1}
                  className="absolute right-3 top-3 z-10 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-zinc-950/85 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200"
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Workspace Identity Bar (Overlapping avatar + title + badges + actions) */}
        <div className={`transition-all duration-250 ease-out motion-reduce:transition-none ${coverVisible ? "p-5 sm:p-6" : "px-5 py-4 sm:px-6"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
              {/* Organization Monogram / Custom Logo Avatar */}
              <div className="relative group shrink-0">
                <div
                  className={`overflow-hidden ${
                    customLogoUrl ? "bg-surface" : activeTheme.avatarBg
                  } flex items-center justify-center font-heading font-semibold shadow-2xl transition-all duration-250 group-hover:scale-[1.02] ${
                    coverVisible
                      ? "h-16 w-16 rounded-2xl border-4 border-surface text-xl sm:text-2xl"
                      : "h-11 w-11 rounded-xl border border-subtle text-base sm:h-12 sm:w-12 sm:text-lg"
                  }`}
                >
                  {customLogoUrl ? (
                    <img
                      src={customLogoUrl}
                      alt={`${organization?.name} Logo`}
                      className="w-full h-full object-cover"
                      onError={() => {
                        setLogoLoadFailed(true);
                      }}
                    />
                  ) : (
                    getInitials(organization?.name)
                  )}
                </div>

                {/* Officer Edit Logo Overlay Badge */}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="page-title">
                    <span className="text-display-gradient">{organization?.name}</span>
                  </h1>
                </div>
                {organization?.invite_code && isOfficer && (
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="mt-1.5 inline-flex max-w-full flex-wrap items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs font-mono bg-elevated hover:bg-surface text-secondary hover:text-primary border border-subtle hover:border-strong transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
                    title="Click to copy organization invite code"
                  >
                    <span className="inline text-muted">Invite Code:</span>
                    <strong className="break-all text-primary">
                      {organization.invite_code}
                    </strong>
                    {copiedCode ? (
                      <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-muted" />
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
              <button
                type="button"
                onClick={toggleCover}
                aria-expanded={coverVisible}
                aria-label={coverVisible ? "Hide cover" : "Show cover"}
                title={coverVisible ? "Hide cover" : "Show cover"}
                className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-xs text-secondary transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-border-strong sm:min-h-8"
              >
                {coverVisible ? (
                  <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">
                  {coverVisible ? "Hide cover" : "Show cover"}
                </span>
              </button>

              <button
                type="button"
                onClick={toggleSummary}
                aria-expanded={summaryVisible}
                aria-label={
                  summaryVisible
                    ? "Hide financial summary"
                    : "Show financial summary"
                }
                title={
                  summaryVisible
                    ? "Hide financial summary"
                    : "Show financial summary"
                }
                className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-xs text-secondary transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-border-strong sm:min-h-8"
              >
                <span className="hidden sm:inline">
                  {summaryVisible
                    ? "Hide financial summary"
                    : "Show financial summary"}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 transition-transform duration-200 ease-out motion-reduce:transition-none ${summaryVisible ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="@container">
        <div
          aria-hidden={!summaryVisible}
          className={`relative z-30 grid transition-[grid-template-rows,opacity] duration-250 ease-out motion-reduce:transition-none ${
            summaryVisible
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0 pointer-events-none"
          }`}
        >
          <div className="overflow-hidden">
            <div
              className={`transition-transform duration-250 ease-out motion-reduce:transition-none ${
                summaryVisible ? "translate-y-0" : "-translate-y-3"
              }`}
            >
              <div data-tour="overview-metrics" className="hidden @min-[1000px]:grid grid-cols-5 items-stretch gap-4 mb-4">
          {/* Metric 1: Net Treasury Balance */}
          <div className="col-span-1 flex flex-col animate-activity-stagger" style={{ "--stagger-index": 0 } as React.CSSProperties}>
            <QuerySection queries={[summaryQuery]}>
              <div className="card-specular-interactive rounded-xl bg-surface border border-subtle hover:border-strong shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between text-muted text-xs mb-1.5 sm:mb-2">
                    <span className="font-mono uppercase tracking-wider text-[11px] sm:text-xs">
                      Treasury Reserve
                    </span>
                    <Wallet className="w-4 h-4 text-secondary shrink-0" />
                  </div>
                  <p className={`overview-kpi-value tabular-nums ${summary && summary.reserve_balance_centavos < 0 ? "text-rose-600 dark:text-rose-400" : "text-primary"}`}>
                    {summary
                      ? overviewAmount(summary.reserve_balance_centavos, currency)
                      : "—"}
                  </p>
                </div>
                <p className={`mt-2.5 text-[11px] font-mono tabular-nums ${summary && summary.reserve_balance_centavos < 0 ? "text-rose-600/90 dark:text-rose-400/90" : "text-muted"}`}>
                  {summary && summary.reserve_balance_centavos < 0
                    ? "Deficit balance"
                    : `Available in ${currency}`}
                </p>
              </div>
            </QuerySection>
          </div>

          {/* Metric 2: Total Collected */}
          <div className="col-span-1 flex flex-col animate-activity-stagger" style={{ "--stagger-index": 1 } as React.CSSProperties}>
            <QuerySection queries={[collectionsQuery]}>
              <div className="card-specular-interactive rounded-xl bg-surface border border-subtle hover:border-strong shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between text-muted text-xs mb-1.5 sm:mb-2">
                    <span className="font-mono uppercase tracking-wider text-[10px] sm:text-xs truncate">
                      Collected
                    </span>
                    <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted shrink-0" />
                  </div>
                  <p className="overview-kpi-value tabular-nums text-primary">
                    {collectionsQuery.data
                      ? overviewAmount(totalCollected, currency)
                      : "—"}
                  </p>
                </div>
                <p className="mt-2.5 text-[11px] font-mono tabular-nums text-muted">
                  {activeCollections.length} active {activeCollections.length === 1 ? "collection" : "collections"}
                </p>
              </div>
            </QuerySection>
          </div>

          {/* Metric 3: Authorized Budgets */}
          <div className="col-span-1 flex flex-col animate-activity-stagger" style={{ "--stagger-index": 2 } as React.CSSProperties}>
            <QuerySection queries={[budgetsQuery]}>
              <div className="card-specular-interactive rounded-xl bg-surface border border-subtle hover:border-strong shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between text-muted text-xs mb-1.5 sm:mb-2">
                    <span className="font-mono uppercase tracking-wider text-[10px] sm:text-xs truncate">
                      Budgets
                    </span>
                    <PieChart className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted shrink-0" />
                  </div>
                  <p className="overview-kpi-value tabular-nums text-primary">
                    {budgetsQuery.data
                      ? overviewAmount(totalBudgetAllocated, currency)
                      : "—"}
                  </p>
                </div>
                <p className="mt-2.5 text-[11px] font-mono tabular-nums text-muted">
                  {activeBudgets.length} active · {budgetUtilPct}% spent
                </p>
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-elevated">
                  <div
                    className={`h-full transition-all duration-300 motion-reduce:transition-none ${budgetUtilPct >= 90 ? "bg-amber-500 dark:bg-amber-400" : "bg-action/70"}`}
                    style={{ width: `${budgetUtilPct}%` }}
                  />
                </div>
              </div>
            </QuerySection>
          </div>

          {/* Metric 4: Recorded Expenses */}
          <div className="col-span-1 flex flex-col animate-activity-stagger" style={{ "--stagger-index": 3 } as React.CSSProperties}>
            <QuerySection queries={[expenditureQuery]}>
              <div className="card-specular-interactive rounded-xl bg-surface border border-subtle hover:border-strong shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between text-muted text-xs mb-1.5 sm:mb-2">
                    <span className="font-mono uppercase tracking-wider text-[10px] sm:text-xs truncate">
                      Expenditure
                    </span>
                    <CreditCard className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted shrink-0" />
                  </div>
                  <p className="overview-kpi-value tabular-nums text-primary">
                    {expenditureQuery.data
                      ? overviewAmount(totalApprovedExpenses, currency)
                      : "—"}
                  </p>
                </div>
                <p className={`mt-2.5 text-[11px] font-mono tabular-nums ${pendingExpenses.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted"}`}>
                  {pendingExpenses.length > 0
                    ? `${pendingExpenses.length} pending review`
                    : expenditureQuery.data?.provisional ? "Provisional" : "Includes approved liquidation spending"}
                </p>
              </div>
            </QuerySection>
          </div>

          {/* Metric 5: Outstanding Advances */}
          <div className="col-span-1 flex flex-col animate-activity-stagger" style={{ "--stagger-index": 4 } as React.CSSProperties}>
            <QuerySection queries={[summaryQuery]}>
              <div className="card-specular-interactive rounded-xl bg-surface border border-subtle hover:border-strong shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between text-muted text-xs mb-1.5 sm:mb-2">
                    <span className="font-mono uppercase tracking-wider text-[10px] sm:text-xs truncate">
                      Advances
                    </span>
                    <FileCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted shrink-0" />
                  </div>
                  <p className="overview-kpi-value tabular-nums text-primary">
                    {summary
                      ? overviewAmount(
                          summary.total_outstanding_advances_centavos,
                          currency,
                        )
                      : "—"}
                  </p>
                </div>
                <p className="mt-2.5 text-[11px] font-mono tabular-nums text-muted">
                  {openAdvancesLabel}
                </p>
              </div>
            </QuerySection>
          </div>
        </div>

              <div data-tour="overview-metrics" className="@min-[1000px]:hidden grid grid-cols-2 items-stretch gap-2.5 mb-5">
          {/* Metric 1: Net Treasury Balance */}
          <div className="col-span-2 flex flex-col animate-activity-stagger" style={{ "--stagger-index": 0 } as React.CSSProperties}>
            <QuerySection queries={[summaryQuery]}>
              <div className="card-specular-interactive rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between text-muted text-xs mb-1.5 sm:mb-2">
                    <span className="font-mono uppercase tracking-wider text-[11px] sm:text-xs">
                      Treasury Reserve
                    </span>
                    <Wallet className="w-4 h-4 text-secondary" />
                  </div>
                  <p className={`metric-value tabular-nums ${summary && summary.reserve_balance_centavos < 0 ? "text-rose-600 dark:text-rose-400" : "text-primary"}`}>
                    {summary
                      ? overviewFullAmount(summary.reserve_balance_centavos, currency)
                      : "—"}
                  </p>
                </div>
                <p className={`mt-2 text-[11px] font-mono tabular-nums ${summary && summary.reserve_balance_centavos < 0 ? "text-rose-600/90 dark:text-rose-400/90" : "text-muted"}`}>
                  {summary && summary.reserve_balance_centavos < 0
                    ? "Deficit balance"
                    : `Available in ${currency}`}
                </p>
              </div>
            </QuerySection>
          </div>

          {/* Metric 2: Total Collected */}
          <div className="col-span-1 flex flex-col animate-activity-stagger" style={{ "--stagger-index": 1 } as React.CSSProperties}>
            <QuerySection queries={[collectionsQuery]}>
              <div className="card-specular-interactive rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between text-muted text-xs mb-1 sm:mb-2">
                    <span className="font-mono uppercase tracking-wider text-[10px] sm:text-xs truncate">
                      Collected
                    </span>
                    <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted shrink-0" />
                  </div>
                  <p className="metric-value tabular-nums break-words text-primary">
                    {collectionsQuery.data
                      ? overviewFullAmount(totalCollected, currency)
                      : "—"}
                  </p>
                </div>
                <p className="mt-2 text-[11px] font-mono tabular-nums text-muted">
                  {activeCollections.length} active
                </p>
              </div>
            </QuerySection>
          </div>

          {/* Metric 3: Authorized Budgets */}
          <div className="col-span-1 flex flex-col animate-activity-stagger" style={{ "--stagger-index": 2 } as React.CSSProperties}>
            <QuerySection queries={[budgetsQuery]}>
              <div className="card-specular-interactive rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between text-muted text-xs mb-1 sm:mb-2">
                    <span className="font-mono uppercase tracking-wider text-[10px] sm:text-xs truncate">
                      Budgets
                    </span>
                    <PieChart className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted shrink-0" />
                  </div>
                  <p className="metric-value tabular-nums break-words text-primary">
                    {budgetsQuery.data
                      ? overviewFullAmount(totalBudgetAllocated, currency)
                      : "—"}
                  </p>
                </div>
                <p className="mt-2 text-[11px] font-mono tabular-nums text-muted">
                  {activeBudgets.length} active · {budgetUtilPct}% spent
                </p>
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-elevated">
                  <div
                    className={`h-full transition-all duration-300 motion-reduce:transition-none ${budgetUtilPct >= 90 ? "bg-amber-500 dark:bg-amber-400" : "bg-action/70"}`}
                    style={{ width: `${budgetUtilPct}%` }}
                  />
                </div>
              </div>
            </QuerySection>
          </div>

          {/* Metric 4: Recorded Expenses */}
          <div className="col-span-1 flex flex-col animate-activity-stagger" style={{ "--stagger-index": 3 } as React.CSSProperties}>
            <QuerySection queries={[expenditureQuery]}>
              <div className="card-specular-interactive rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between text-muted text-xs mb-1 sm:mb-2">
                    <span className="font-mono uppercase tracking-wider text-[10px] sm:text-xs truncate">
                      Expenditure
                    </span>
                    <CreditCard className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted shrink-0" />
                  </div>
                  <p className="metric-value tabular-nums break-words text-primary">
                    {expensesQuery.data
                      ? overviewFullAmount(totalApprovedExpenses, currency)
                      : "—"}
                  </p>
                </div>
                <p className={`mt-2 text-[11px] font-mono tabular-nums ${pendingExpenses.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted"}`}>
                  {pendingExpenses.length > 0
                    ? `${pendingExpenses.length} pending`
                    : expenditureQuery.data?.provisional ? "Provisional" : "Includes approved liquidation spending"}
                </p>
              </div>
            </QuerySection>
          </div>

          {/* Metric 5: Outstanding Advances */}
          <div className="col-span-1 flex flex-col animate-activity-stagger" style={{ "--stagger-index": 4 } as React.CSSProperties}>
            <QuerySection queries={[summaryQuery]}>
              <div className="card-specular-interactive rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between text-muted text-xs mb-1 sm:mb-2">
                    <span className="font-mono uppercase tracking-wider text-[10px] sm:text-xs truncate">
                      Advances
                    </span>
                    <FileCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted shrink-0" />
                  </div>
                  <p className="metric-value tabular-nums break-words text-primary">
                    {summary
                      ? overviewFullAmount(
                          summary.total_outstanding_advances_centavos,
                          currency,
                        )
                      : "—"}
                  </p>
                </div>
                <p className="mt-2 text-[11px] font-mono tabular-nums text-muted">
                  {openAdvancesLabel}
                </p>
              </div>
            </QuerySection>
          </div>
        </div>
            </div>
          </div>
        </div>

        {insightsStrip && (
          <div className="mb-4 @min-[1000px]:hidden">{insightsStrip}</div>
        )}

        <Select
          id="overview-dashboard-section"
          label="Dashboard section"
          labelClassName="cursor-pointer text-sm font-semibold text-primary"
          className="mb-4 gap-2 @min-[1000px]:hidden"
          buttonClassName="min-h-[46px]"
          value={overviewSection}
          options={sections
            .filter(
              ([id]) => id !== "reviews" || canReviewFinances(membership.role),
            )
            .map(([value, label]) => ({ value, label }))}
          onValueChange={(value) => {
            const section = sections.find(([id]) => id === value);
            if (section) setOverviewSection(section[0]);
          }}
        />
        <div
          className={`flex flex-col @min-[1000px]:grid @min-[1000px]:grid-cols-[minmax(0,1fr)_296px] ${
            insightsStrip
              ? "@min-[1200px]:grid-cols-[264px_minmax(0,1fr)_296px]"
              : ""
          } gap-6 xl:gap-7 items-start`}
        >
          {/* FINANCIAL ACTIVITY STREAM (Center Primary Focus on Desktop / Mobile Activity Tab) */}
          <div
            data-tour="overview-activity"
            className={`order-2 @min-[1000px]:order-none @min-[1000px]:col-start-1 @min-[1000px]:row-start-1 ${
              insightsStrip
                ? "@min-[1200px]:col-start-2 @min-[1200px]:row-start-1"
                : ""
            } w-full min-w-0 ${
              overviewSection === "activity"
                ? "block"
                : "hidden @min-[1000px]:block"
            }`}
          >
            <FinancialActivityFeed
              orgId={orgId}
              currency={currency}
              expenses={expenses}
              collections={collections}
              budgets={budgets}
              advances={advances}
              sources={{
                expenses: expensesQuery,
                collections: collectionsQuery,
                budgets: budgetsQuery,
                advances: advancesQuery,
              }}
            />
          </div>

          {/* DESKTOP RAILS: Bani Insights (Left at >=1200px) & Financial Widgets (Right) / Mobile Operations Tab */}
          <div
            className={`order-1 @min-[1000px]:order-none @min-[1000px]:col-start-2 @min-[1000px]:row-start-1 w-full min-w-0 space-y-4 ${
              insightsStrip ? "@min-[1200px]:contents" : ""
            } ${
              overviewSection === "activity"
                ? "hidden @min-[1000px]:block"
                : "block"
            }`}
          >
            {insightsStrip && (
              <div className="hidden @min-[1000px]:block @min-[1200px]:col-start-1 @min-[1200px]:row-start-1 @min-[1200px]:sticky @min-[1200px]:-top-2 self-start w-full min-w-0">
                {insightsStrip}
              </div>
            )}
            <div className="min-w-0 w-full space-y-4 @min-[1200px]:col-start-3 @min-[1200px]:row-start-1 @min-[1200px]:sticky @min-[1200px]:-top-2 self-start @min-[1200px]:max-h-[calc(100dvh-5.5rem)] @min-[1200px]:overflow-y-auto scrollbar-none">
              <OperationalWidgets
                mobileSection={overviewSection}
                orgId={orgId}
                currency={currency}
                userRole={membership.role}
                activeCollections={activeCollections}
                budgets={budgets}
                expenses={expenses}
                pendingAdvances={pendingAdvances}
                pendingExpensesCount={pendingExpenses.length}
                pendingLiquidationsCount={
                  advances.filter((a) =>
                    canReviewAdvance(a, membership.profile_id, membership.role),
                  ).length
                }
                isCollectionsLoading={collectionsQuery.isPending}
                isAdvancesLoading={advancesQuery.isPending}
                isBudgetsLoading={budgetsQuery.isPending}
                isApprovalsLoading={
                  (canReviewFinances(membership.role) && reviewExpensesQuery.isPending) ||
                  advancesQuery.isPending
                }
              />
            </div>
          </div>
        </div>

        {/* CUSTOMIZE COVER MODAL */}
      </div>
      <Modal
        isOpen={canEditProfile && editorTab !== null}
        onClose={closeEditor}
        labelledBy={
          confirmDiscard ? "discard-editor-title" : "org-editor-title"
        }
        className="flex max-h-[calc(100dvh-2rem)]! flex-col overflow-hidden! p-0!"
      >
        {confirmDiscard && (
          <section
            ref={discardPromptRef}
            className="min-h-0 overflow-y-auto p-5 sm:p-6"
            aria-describedby="discard-editor-description"
          >
            <h2
              id="discard-editor-title"
              className="font-semibold text-primary section-title"
            >
              Discard changes?
            </h2>
            <p
              id="discard-editor-description"
              className="mt-2 text-sm text-secondary"
            >
              You have unsaved changes. Are you sure you want to discard them?
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="min-h-11"
                onClick={keepEditing}
              >
                Keep editing
              </Button>
              <Button
                variant="danger"
                className="min-h-11"
                onClick={() => {
                  setConfirmDiscard(false);
                  setEditorTab(null);
                }}
              >
                Discard changes
              </Button>
            </div>
          </section>
        )}
        <div
          hidden={confirmDiscard}
          className={confirmDiscard ? "" : "flex min-h-0 flex-col"}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4 sm:px-6">
            <h2
              id="org-editor-title"
              className="font-semibold text-primary section-title"
            >
              Edit organization
            </h2>
            <button
              type="button"
              aria-label="Close edit organization"
              disabled={editorSaving}
              onClick={closeEditor}
              className="grid size-11 cursor-pointer place-items-center rounded-full text-muted hover:bg-hover-surface hover:text-primary focus-visible:ring-2 focus-visible:ring-strong disabled:opacity-50"
            >
              <X className="size-5" />
            </button>
          </header>
          <div
            role="tablist"
            aria-label="Organization editor sections"
            className="mx-5 mt-2 flex shrink-0 gap-4 border-b border-subtle sm:mx-6"
          >
            {editorTabs.map((label, index) => (
              <button
                key={label}
                id={"editor-tab-" + index}
                type="button"
                role="tab"
                aria-selected={editorTab === label}
                aria-controls={"editor-panel-" + index}
                tabIndex={editorTab === label ? 0 : -1}
                disabled={editorSaving}
                className="min-h-11 cursor-pointer border-b-2 border-transparent px-2 text-sm text-secondary hover:text-primary aria-selected:border-primary aria-selected:font-medium aria-selected:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-strong"
                onClick={() => setEditorTab(label)}
                onKeyDown={(event) => {
                  const next = {
                    ArrowLeft: (index + 2) % 3,
                    ArrowRight: (index + 1) % 3,
                    Home: 0,
                    End: 2,
                  }[event.key];
                  if (next === undefined) return;
                  event.preventDefault();
                  setEditorTab(editorTabs[next]);
                  document.getElementById("editor-tab-" + next)?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
            <section
              role="tabpanel"
              id="editor-panel-0"
              aria-labelledby="editor-tab-0"
              hidden={!detailsOpen}
            >
              <form
                id="organization-details-form"
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canSaveDetails && !editorSaving) saveProfile.mutate();
                }}
              >
                <Input
                  label="Organization name"
                  id="org-editor-name"
                  className="text-base sm:text-sm"
                  required
                  maxLength={150}
                  value={profileName}
                  disabled={editorSaving}
                  onChange={(event) => setProfileName(event.target.value)}
                  aria-invalid={!profileName.trim()}
                  aria-describedby={
                    !profileName.trim() ? "org-editor-name-error" : undefined
                  }
                />
                {!profileName.trim() && (
                  <p
                    id="org-editor-name-error"
                    className="text-sm text-rose-700 dark:text-rose-300"
                  >
                    Enter an organization name.
                  </p>
                )}
                <div>
                  <label
                    htmlFor="org-editor-description"
                    className="mb-2 block text-sm text-secondary"
                  >
                    Description
                  </label>
                  <textarea
                    id="org-editor-description"
                    aria-describedby="org-editor-description-count"
                    placeholder="Describe your organization..."
                    maxLength={300}
                    value={description}
                    disabled={editorSaving}
                    onChange={(event) => setDescription(event.target.value)}
                    className="block h-28 w-full resize-none rounded-2xl border border-subtle bg-secondary-surface p-3 text-base leading-relaxed text-primary placeholder:text-muted focus:border-strong focus:outline-none sm:text-sm"
                  />
                  <p
                    id="org-editor-description-count"
                    className="mt-1 text-right text-xs tabular-nums text-muted"
                  >
                    {description.length}/300
                  </p>
                </div>
                {saveProfile.isError && (
                  <p role="alert" className="text-sm text-sem-error-fg">
                    {saveProfile.error.message}
                  </p>
                )}
              </form>
            </section>
            <section
              role="tabpanel"
              id="editor-panel-1"
              aria-labelledby="editor-tab-1"
              hidden={!coverOpen}
              className="space-y-4"
            >
              {/* Customizer Mode Navigation Tabs */}
              <div className="flex items-center p-1 rounded-2xl bg-secondary-surface border border-subtle gap-1">
                <button
                  type="button"
                  onClick={() => setCoverTab("upload")}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-mono transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    coverTab === "upload"
                      ? "bg-surface text-primary font-medium shadow-(--shadow-pill) dark:bg-zinc-800 dark:text-white dark:shadow-sm"
                      : "text-secondary hover:text-primary"
                  }`}
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Upload Photo</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCoverTab("presets")}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-mono transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    coverTab === "presets"
                      ? "bg-surface text-primary font-medium shadow-(--shadow-pill) dark:bg-zinc-800 dark:text-white dark:shadow-sm"
                      : "text-secondary hover:text-primary"
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" />
                  <span>Preset Themes</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCoverTab("url")}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-mono transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    coverTab === "url"
                      ? "bg-surface text-primary font-medium shadow-(--shadow-pill) dark:bg-zinc-800 dark:text-white dark:shadow-sm"
                      : "text-secondary hover:text-primary"
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Web Link</span>
                </button>
              </div>

              {/* TAB 1: BROWSE & DRAG-AND-DROP FILE UPLOAD */}
              <div hidden={coverTab !== "upload"} className="space-y-4">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileInputChange}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                />

                {!previewImage ? (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      fileInputRef.current?.click();
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-3xl p-8 text-center flex flex-col items-center justify-center gap-3 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-zinc-400 ${
                      isDragging
                        ? "border-emerald-500 bg-emerald-500/10 ring-4 ring-emerald-500/10"
                        : "border-subtle hover:border-strong bg-secondary-surface/70 hover:bg-hover-surface"
                    }`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-surface border border-subtle flex items-center justify-center text-secondary group-hover:scale-105 transition-transform">
                      <UploadCloud className="w-6 h-6 text-muted" />
                    </div>

                    <div>
                      <p className="text-sm font-medium text-primary">
                        Click to browse or drag and drop photo
                      </p>
                      <p className="text-xs text-muted mt-1">
                        JPEG, PNG, or WebP • Maximum 5 MB • At least 600×200 px
                      </p>
                    </div>

                    <Badge className="mt-1" >
                      Browse Computer
                    </Badge>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative rounded-2xl overflow-hidden border border-zinc-800 h-36 bg-zinc-900">
                      <img
                        src={previewImage}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewImage(null);
                          setCoverSource(null);
                          setImageMeta(null);
                        }}
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-full bg-black/70 hover:bg-black text-zinc-300 hover:text-white transition-all cursor-pointer shadow-lg"
                        title="Remove photo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {coverSource && (
                      <OverviewCrop
                        key={coverSource}
                        src={coverSource}
                        ratio={coverRatio}
                        showMobilePreview
                        onApply={setPreviewImage}
                      />
                    )}
                    {imageMeta && (
                      <div className="p-3 rounded-xl bg-secondary-surface border border-subtle flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-2 truncate">
                          <FileImage className="w-4 h-4 text-muted shrink-0" />
                          <span className="text-primary truncate">
                            {imageMeta.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-secondary shrink-0">
                          <span>{imageMeta.dimensions}</span>
                          <span>•</span>
                          <span>{imageMeta.size}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {uploadError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 text-zinc-500" />
                    <p>{uploadError}</p>
                  </div>
                )}
              </div>

              {/* TAB 2: PRESET GRADIENTS */}
              {coverTab === "presets" && (
                <div className="space-y-3">
                  <label className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                    Fintech Color Presets
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {COVER_THEMES.map((theme) => {
                      const isSelected = draftTheme === theme.id;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setDraftTheme(theme.id)}
                          className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col gap-2 ${
                            isSelected
                              ? "border-zinc-400 bg-zinc-900 shadow-md ring-1 ring-zinc-400/40"
                              : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900"
                          }`}
                        >
                          <div
                            className={`h-8 w-full rounded-xl bg-gradient-to-r ${theme.gradient} border border-white/10`}
                          />
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-white truncate">
                              {theme.name}
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 3: CUSTOM IMAGE URL */}
              {coverTab === "url" && (
                <div className="space-y-3">
                  <Input
                    label="Public image link"
                    className="text-base sm:text-sm"
                    placeholder="https://images.unsplash.com/... or school banner URL"
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                  />
                  <p className="text-[11px] text-zinc-500">
                    Paste any public link to a PNG, JPG, or WebP photo.
                  </p>
                </div>
              )}

              {coverSaveError && (
                <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
                  {coverSaveError}
                </p>
              )}
            </section>
            <section
              role="tabpanel"
              id="editor-panel-2"
              aria-labelledby="editor-tab-2"
              hidden={!logoOpen}
              className="space-y-4"
            >
              {/* Drag and Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsLogoDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsLogoDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsLogoDragging(false);
                  if (editorSaving) return;
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleLogoFileProcess(e.dataTransfer.files[0]);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-disabled={editorSaving}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  if (!editorSaving) logoFileInputRef.current?.click();
                }}
                onClick={() => {
                  if (!editorSaving) logoFileInputRef.current?.click();
                }}
                className={`relative border-2 border-dashed rounded-3xl p-6 sm:p-8 text-center cursor-pointer transition-all focus-visible:ring-2 focus-visible:ring-zinc-400 ${
                  isLogoDragging
                    ? "border-zinc-400 bg-zinc-800/40 scale-[0.99]"
                    : "border-zinc-800 hover:border-zinc-700 bg-zinc-900/30 hover:bg-zinc-900/50"
                }`}
              >
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleLogoFileProcess(e.target.files[0]);
                    }
                  }}
                />

                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-2xl bg-surface border border-subtle flex items-center justify-center text-secondary mb-3 group-hover:scale-105 transition-transform">
                    <UploadCloud className="w-6 h-6 text-secondary" />
                  </div>

                  <p className="text-sm font-medium text-primary mb-1">
                    Click to browse or drag and drop your logo
                  </p>
                  <p className="text-xs text-muted font-mono">
                    PNG, JPG, WebP, or SVG &bull; Max 5 MB &bull; Square (1:1)
                    recommended
                  </p>
                </div>
              </div>

              {logoUploadError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-zinc-500 shrink-0" />
                  <span>{logoUploadError}</span>
                </div>
              )}

              {/* Live Preview Area (Large Avatar + Header Preview) */}
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block mb-3">
                  Preview Across Workspace
                </span>

                <div className="grid grid-cols-2 gap-4 bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800/80">
                  {/* Overview Avatar Preview */}
                  <div className="flex flex-col items-center text-center p-3 rounded-xl surface-raised border border-zinc-800/90">
                    <span className="text-[10px] font-mono text-zinc-500 mb-2">
                      Overview Profile
                    </span>
                    <div
                      className={`w-16 h-16 rounded-2xl overflow-hidden ${
                        logoPreview || customLogoUrl
                          ? "bg-zinc-950"
                          : activeTheme.avatarBg
                      } border-2 border-zinc-700 flex items-center justify-center font-heading font-semibold text-xl text-white shadow-lg`}
                    >
                      {logoPreview ? (
                        <img
                          src={logoPreview}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      ) : customLogoUrl ? (
                        <img
                          src={customLogoUrl}
                          alt="Current"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        getInitials(organization?.name)
                      )}
                    </div>
                  </div>

                  {/* Sidebar Icon Preview */}
                  <div className="flex flex-col items-center text-center p-3 rounded-xl surface-raised border border-zinc-800/90">
                    <span className="text-[10px] font-mono text-zinc-500 mb-2">
                      Sidebar &amp; Nav
                    </span>
                    <div className="w-10 h-10 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-700 flex items-center justify-center font-semibold text-xs text-white shadow-md">
                      {logoPreview ? (
                        <img
                          src={logoPreview}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      ) : customLogoUrl ? (
                        <img
                          src={customLogoUrl}
                          alt="Current"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        getInitials(organization?.name)
                      )}
                    </div>
                  </div>
                </div>

                {logoMeta && (
                  <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-zinc-400 bg-zinc-900/40 px-3 py-1.5 rounded-xl border border-zinc-800">
                    <span className="truncate max-w-[200px]">
                      {logoMeta.name}
                    </span>
                    <span>
                      {logoMeta.dimensions} &bull; {logoMeta.size}
                    </span>
                  </div>
                )}
              </div>

              {logoPreview && logoSource && (
                <OverviewCrop
                  key={logoSource}
                  src={logoSource}
                  ratio={1}
                  onApply={setLogoPreview}
                />
              )}
            </section>
          </div>
          <footer className="flex shrink-0 flex-col gap-2 border-t border-zinc-800 px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-6">
            {coverOpen && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 self-start sm:mr-auto"
                onClick={handleResetToDefault}
              >
                Reset to default
              </Button>
            )}
            {logoOpen && customLogoUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 self-start text-rose-400 sm:mr-auto"
                disabled={editorSaving}
                onClick={handleRemoveLogo}
              >
                Remove logo
              </Button>
            )}
            <Button
              variant="outline"
              className="ml-auto hidden h-11 sm:inline-flex"
              disabled={editorSaving}
              onClick={closeEditor}
            >
              Cancel
            </Button>
            {detailsOpen && (
              <Button
                type="submit"
                form="organization-details-form"
                className="h-11 w-full sm:w-auto"
                isLoading={saveProfile.isPending}
                disabled={!canSaveDetails}
              >
                {saveProfile.isPending ? "Saving…" : "Save changes"}
              </Button>
            )}
            {coverOpen && (
              <Button
                className="h-11 w-full sm:w-auto"
                disabled={
                  (coverTab === "upload" && !previewImage) ||
                  (coverTab === "presets" && !draftTheme)
                }
                onClick={() => {
                  if (coverTab === "upload") handleSaveUploadedImage();
                  else if (coverTab === "url") handleSaveCustomImage();
                  else saveCover("", draftTheme);
                }}
              >
                {coverTab === "upload"
                  ? "Apply photo"
                  : coverTab === "url"
                    ? "Apply link"
                    : "Apply preset"}
              </Button>
            )}
            {logoOpen && (
              <Button
                className="h-11 w-full sm:w-auto"
                onClick={handleSaveLogo}
                disabled={!logoPreview}
                isLoading={updateLogoMutation.isPending}
              >
                {updateLogoMutation.isPending ? "Saving…" : "Save logo"}
              </Button>
            )}
            <Button
              variant="outline"
              className="h-11 w-full sm:hidden"
              disabled={editorSaving}
              onClick={closeEditor}
            >
              Cancel
            </Button>
          </footer>
        </div>
      </Modal>
    </div>
  );
}

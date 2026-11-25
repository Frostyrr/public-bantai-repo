import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Globe } from "lucide-react";
import API from "../../../config/apiClient";
import Button from "../../../components/ui/Button";
import Select from "../../../components/ui/Select";
import TimeZoneSelect from "../../../components/ui/TimeZoneSelect";
import { buildTimeZoneOption, getBrowserTimeZone } from "../../../lib/timezones";
import { SUPPORTED_CURRENCIES } from "../../../lib/currencies";
import { updateOrganizationRegionalSettings, type OrganizationDetails } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { formatErrorMessage } from "../../../utils/formatError";

interface RegionalSettingsProps {
  organization: OrganizationDetails;
  isOwnerOrAdmin: boolean;
}

export default function RegionalSettings({
  organization,
  isOwnerOrAdmin,
}: RegionalSettingsProps) {
  const queryClient = useQueryClient();
  const suggestedTimeZone = useMemo(() => {
    const zone = getBrowserTimeZone();
    return zone ? buildTimeZoneOption(zone) : null;
  }, []);
  const savedCurrency = organization.currency || "PHP";
  const timeZoneQueryKey = ["directory", organization.id, "time-zone"];

  const timeZoneQuery = useQuery({
    queryKey: timeZoneQueryKey,
    enabled: Boolean(organization.id),
    queryFn: async () =>
      (await API.get<{ timeZone: string | null }>(`/organizations/${organization.id}/directory/time-zone`))
        .data.timeZone,
  });

  const savedTimeZone = timeZoneQuery.data ?? organization.time_zone ?? "";

  const [currencyInput, setCurrencyInput] = useState<string | null>(null);
  const [timeZoneInput, setTimeZoneInput] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const effectiveCurrency = currencyInput ?? savedCurrency;
  const effectiveTimeZone = timeZoneInput ?? savedTimeZone;
  const currencyChanged = effectiveCurrency !== savedCurrency;
  const timeZoneChanged =
    Boolean(effectiveTimeZone.trim()) && effectiveTimeZone.trim() !== savedTimeZone;
  const hasChanges = currencyChanged || timeZoneChanged;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: { currency?: string; timeZone?: string } = {};
      if (currencyChanged) payload.currency = effectiveCurrency;
      if (timeZoneChanged) payload.timeZone = effectiveTimeZone.trim();
      return updateOrganizationRegionalSettings(organization.id, payload);
    },
    onSuccess: async (updated) => {
      if (updated.time_zone !== undefined) {
        queryClient.setQueryData(timeZoneQueryKey, updated.time_zone ?? null);
      }
      setCurrencyInput(null);
      setTimeZoneInput(null);
      setSavedNotice(true);
      toast.success("Regional settings updated");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organization", organization.id] }),
        queryClient.invalidateQueries({ queryKey: ["organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["directory-obligations"] }),
      ]);
    },
  });

  const error = saveMutation.error ?? timeZoneQuery.error;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isOwnerOrAdmin || !hasChanges || saveMutation.isPending) return;
    setSavedNotice(false);
    saveMutation.mutate();
  };

  return (
    <section className="rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-6">
      <div className="flex items-center gap-3 border-b border-subtle pb-4 mb-5">
        <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-secondary shrink-0">
          <Globe className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-heading font-medium text-primary">Regional Settings</h2>
          <p className="mt-0.5 text-xs text-secondary">
            Configure your workspace&apos;s base currency and time zone for financial records and due dates.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Select
            label="Base currency"
            value={effectiveCurrency}
            disabled={!isOwnerOrAdmin || saveMutation.isPending}
            onChange={(event) => {
              setCurrencyInput(event.target.value);
              setSavedNotice(false);
              if (saveMutation.isError) saveMutation.reset();
            }}
            options={SUPPORTED_CURRENCIES.map((currency) => ({
              value: currency.code,
              label: currency.label,
            }))}
          />
          <p className="text-xs text-muted">
            Currency changes are only available before financial records exist. Historical amounts are never converted.
          </p>
        </div>

        <div className="space-y-1.5">
          <TimeZoneSelect
            label="Organization time zone"
            suggestedTimeZone={suggestedTimeZone?.value}
            value={effectiveTimeZone}
            disabled={!isOwnerOrAdmin || saveMutation.isPending || (timeZoneQuery.isLoading && !savedTimeZone)}
            placeholder={timeZoneQuery.isLoading ? "Loading time zone..." : "Select organization time zone"}
            onChange={(zone) => {
              setTimeZoneInput(zone);
              setSavedNotice(false);
              if (saveMutation.isError) saveMutation.reset();
            }}
          />
          <p className="text-xs text-muted">
            Used to interpret due dates, determine when obligations become overdue, and align financial date cutoffs. Changing this setting does not alter historical timestamps or modify existing deadlines.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-xs text-sem-error-fg">
            {formatErrorMessage(error)}
          </p>
        )}

        {isOwnerOrAdmin && (
          <footer className="-mx-6 mt-5 border-t border-subtle px-6 pt-4 flex items-center justify-between gap-3">
            <div className="min-h-[1rem]">
              {savedNotice && !hasChanges && !saveMutation.isPending && (
                <span className="inline-flex items-center gap-1.5 text-xs text-sem-success-fg">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Changes saved
                </span>
              )}
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!hasChanges || saveMutation.isPending}
              isLoading={saveMutation.isPending}
            >
              Save Changes
            </Button>
          </footer>
        )}
      </form>
    </section>
  );
}

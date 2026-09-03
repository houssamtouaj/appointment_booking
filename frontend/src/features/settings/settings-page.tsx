import { describeError, requestIdOf } from '@/api/error-copy'
import { Container } from '@/components/container'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { BusinessForm } from '@/features/settings/business-form'
import { PolicyForm } from '@/features/settings/policy-form'
import { useBusinessSettings, usePolicySettings } from '@/features/settings/settings-queries'
import { useTranslation } from '@/i18n'

/**
 * Screen 9: everything about the business that is not a person, a service or an
 * appointment.
 *
 * Owner-only end to end, and unlike the catalogue and the roster it always was:
 * neither half of this screen has a staff-readable version worth rendering. The
 * route sits under `RequireOwner` (`routes.tsx`), the API refuses both writes
 * with `@PreAuthorize`, and a staff member who types `/settings` is redirected
 * with an explanation.
 *
 * The two forms are separate submissions on purpose. They are different
 * resources with different endpoints, and one of them — the timezone — is a
 * two-step conversation. Folding them into one Save would mean a refused
 * timezone change also holding the booking rules hostage.
 */
export function SettingsPage() {
  const { t } = useTranslation()
  const business = useBusinessSettings()
  const policy = usePolicySettings()

  return (
    <Container className="pb-16">
      <PageHeader
        eyebrow={t('admin.eyebrow')}
        title={t('settings.title')}
        description={t('settings.description')}
      />

      {business.isPending ? (
        <SettingsSkeleton label={t('settings.loadingBusiness')} />
      ) : business.error && business.data === undefined ? (
        <ErrorState
          title={t('settings.businessErrorTitle')}
          description={describeError(business.error)}
          requestId={requestIdOf(business.error)}
          onRetry={() => void business.refetch()}
        />
      ) : business.data ? (
        <BusinessForm business={business.data} />
      ) : null}

      {policy.isPending ? (
        <SettingsSkeleton label={t('settings.loadingPolicy')} className="mt-12" />
      ) : policy.error && policy.data === undefined ? (
        <ErrorState
          className="mt-12"
          title={t('settings.policyErrorTitle')}
          description={describeError(policy.error)}
          requestId={requestIdOf(policy.error)}
          onRetry={() => void policy.refetch()}
        />
      ) : policy.data ? (
        <PolicyForm policy={policy.data} />
      ) : null}
    </Container>
  )
}

/**
 * The shape of a form, not a spinner (F20). Each half loads independently, so
 * this appears twice and each one holds only its own geometry — the whole point
 * of building skeletons per surface rather than sharing one.
 */
function SettingsSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div className={className}>
      <span className="sr-only" role="status">
        {label}
      </span>
      <Skeleton className="h-6 w-32" />
      <div className="max-w-copy mt-6 grid gap-5">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    </div>
  )
}

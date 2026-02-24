import { useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useLocaleContext } from '@/App';
import { useAuth } from '@/hooks/useAuth';

const routeTitles: Record<string, string> = {
  '/': 'nav.dashboard',
  '/agent': 'nav.agent',
  '/tools': 'nav.tools',
  '/cron': 'nav.cron',
  '/integrations': 'nav.integrations',
  '/memory': 'nav.memory',
  '/config': 'nav.config',
  '/cost': 'nav.cost',
  '/logs': 'nav.logs',
  '/doctor': 'nav.doctor',
};

export default function Header() {
  const location = useLocation();
  const { logout } = useAuth();
  const { locale, setAppLocale } = useLocaleContext();

  const titleKey = routeTitles[location.pathname] ?? 'nav.dashboard';
  const pageTitle = t(titleKey);

  const toggleLanguage = () => {
    setAppLocale(locale === 'en' ? 'tr' : 'en');
  };

  return (
    <header className="h-14 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-3 sm:px-6">
      {/* Page title */}
      <h1 className="text-base sm:text-lg font-semibold text-white truncate">{pageTitle}</h1>

      {/* Right-side controls */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Language switcher */}
        <button
          type="button"
          onClick={toggleLanguage}
          className="px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-medium border border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          title={locale === 'en' ? 'Switch to Turkish' : 'Switch to English'}
          aria-label={locale === 'en' ? 'Switch to Turkish' : 'Switch to English'}
        >
          {locale === 'en' ? 'EN' : 'TR'}
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          title={t('auth.logout')}
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">{t('auth.logout')}</span>
        </button>
      </div>
    </header>
  );
}

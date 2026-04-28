import { useEffect } from 'react';

interface Props {
  isDirty: boolean;
}

/**
 * Browser ``beforeunload`` warning for tab close / hard navigation when there
 * are unsaved pipeline edits.
 *
 * The previous in-app SPA-navigation guard used React Router's ``useBlocker``,
 * which requires a data router (``createBrowserRouter``). ``App.tsx`` still
 * uses the declarative ``<BrowserRouter>``, so calling ``useBlocker`` throws
 * and blanks the page. Restore the SPA guard by migrating App to a data
 * router.
 */
export default function PipelineDirtyGuard({ isDirty }: Props) {
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  return null;
}

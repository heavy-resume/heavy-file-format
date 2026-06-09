import { reduceExistingImageAttachments } from '../../editor/components/image/image';
import { getRenderApp, state } from '../../state';
import { showTransientNotice } from '../../transient-notice';
import type { AppActionHandler } from './types';

const reduceExistingImages: AppActionHandler = () => {
  state.imageAttachmentReductionStatus = { state: 'reducing', message: 'Reducing...' };
  getRenderApp()();
  showTransientNotice('Reducing attached images...');
  void reduceExistingImageAttachments()
    .then((result) => {
      state.imageAttachmentReductionStatus = result.reduced === 0
        ? { state: 'unchanged', message: 'Already Reduced' }
        : { state: 'reduced', message: `Reduced ${result.reduced} Image${result.reduced === 1 ? '' : 's'}` };
      getRenderApp()();
      showTransientNotice(
        result.reduced === 0
          ? 'No attached images needed reduction.'
          : `Reduced ${result.reduced} attached image${result.reduced === 1 ? '' : 's'}.`
      );
    })
    .catch((error) => {
      state.imageAttachmentReductionStatus = { state: 'error', message: 'Try Again' };
      getRenderApp()();
      showTransientNotice(`Could not reduce images: ${error instanceof Error ? error.message : String(error)}`);
    });
};

export const imageAttachmentActions: Record<string, AppActionHandler> = {
  'reduce-existing-image-attachments': reduceExistingImages,
};

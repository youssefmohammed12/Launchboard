import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeMaterial } from '../test/fixtures';
import { MAX_MATERIALS } from '../utils/materials';
import { MaterialSection } from './MaterialSection';

function renderSection(materials = [makeMaterial()]) {
  const onAddMaterial = vi.fn();
  const onUpdateMaterial = vi.fn();
  const onRemoveMaterial = vi.fn();
  const onMaterialStatusChange = vi.fn();

  render(
    <MaterialSection
      materials={materials}
      onAddMaterial={onAddMaterial}
      onUpdateMaterial={onUpdateMaterial}
      onRemoveMaterial={onRemoveMaterial}
      onMaterialStatusChange={onMaterialStatusChange}
    />,
  );

  return { onAddMaterial, onUpdateMaterial, onRemoveMaterial, onMaterialStatusChange };
}

describe('MaterialSection', () => {
  it('shows an empty state and an add action', () => {
    renderSection([]);

    expect(screen.getByRole('heading', { name: 'Application materials' })).toBeInTheDocument();
    expect(screen.getByText(/No materials yet/)).toBeInTheDocument();
    expect(screen.getByText(/does not store the files themselves/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add material' })).toBeInTheDocument();
  });

  it('disables adding materials at the collection limit', () => {
    renderSection(
      Array.from({ length: MAX_MATERIALS }, (_, index) =>
        makeMaterial({ id: `material-${index}`, label: `Material ${index}` }),
      ),
    );

    expect(screen.getByRole('button', { name: 'Add material' })).toBeDisabled();
    expect(screen.getByText(new RegExp(`${MAX_MATERIALS}-material limit`))).toBeInTheDocument();
  });

  it('renders material details, status, link and notes', () => {
    const material = makeMaterial({
      id: 'material-1',
      label: 'Frontend Resume',
      kind: 'Resume',
      version: 'v2',
      status: 'Submitted',
      url: 'https://example.com/resume.pdf',
      notes: 'Tailored for Northwind.',
    });

    renderSection([material]);

    expect(screen.getByText('Frontend Resume')).toBeInTheDocument();
    expect(screen.getByText('Resume')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getAllByText('Submitted')).not.toHaveLength(0);
    expect(screen.getByLabelText('Status for Frontend Resume')).toHaveValue('Submitted');
    expect(screen.getByText('Tailored for Northwind.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Frontend Resume' })).toHaveAttribute(
      'href',
      'https://example.com/resume.pdf',
    );
    expect(screen.getByRole('link', { name: 'Open Frontend Resume' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(screen.getByRole('link', { name: 'Open Frontend Resume' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });

  it('does not render an empty link for a draft without a URL', () => {
    renderSection([
      makeMaterial({ id: 'material-1', label: 'Draft resume', status: 'Draft', url: '' }),
    ]);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getAllByText('Draft')).not.toHaveLength(0);
    expect(screen.getByLabelText('Status for Draft resume')).toHaveValue('Draft');
  });

  it('validates the add form and saves a material with no URL', () => {
    const { onAddMaterial } = renderSection([]);

    fireEvent.click(screen.getByRole('button', { name: 'Add material' }));
    expect(screen.getByRole('heading', { name: 'Add material' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Label/)).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));
    expect(screen.getByText('Enter a material label.')).toBeInTheDocument();
    expect(onAddMaterial).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: '  Draft resume  ' } });
    fireEvent.change(screen.getByLabelText(/Link/), { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));
    expect(
      screen.getByText('Enter a valid URL starting with http:// or https://.'),
    ).toBeInTheDocument();
    expect(onAddMaterial).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Link/), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Version/), { target: { value: '  v1  ' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'Cover Letter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));

    expect(onAddMaterial).toHaveBeenCalledWith({
      label: 'Draft resume',
      kind: 'Cover Letter',
      url: '',
      version: 'v1',
      status: 'Draft',
      notes: '',
    });
  });

  it('edits one material and can cancel without saving', () => {
    const material = makeMaterial({ id: 'material-1', label: 'Frontend Resume' });
    const { onUpdateMaterial } = renderSection([material]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit material Frontend Resume' }));
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: 'Backend Resume' } });
    fireEvent.change(screen.getByLabelText(/Version/), { target: { value: 'v3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));

    expect(onUpdateMaterial).toHaveBeenCalledWith(
      'material-1',
      expect.objectContaining({ label: 'Backend Resume', version: 'v3' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit material Frontend Resume' }));
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: 'Discarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onUpdateMaterial).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Edit material' })).not.toBeInTheDocument();
  });

  it('changes a material status without touching other materials', () => {
    const first = makeMaterial({ id: 'material-1', label: 'Resume', status: 'Ready' });
    const second = makeMaterial({
      id: 'material-2',
      label: 'Portfolio',
      kind: 'Portfolio',
      status: 'Draft',
    });
    const { onMaterialStatusChange } = renderSection([first, second]);

    fireEvent.change(screen.getByLabelText('Status for Portfolio'), {
      target: { value: 'Submitted' },
    });

    expect(onMaterialStatusChange).toHaveBeenCalledWith('material-2', 'Submitted');
    expect(screen.getByLabelText('Status for Resume')).toHaveValue('Ready');
  });

  it('confirms deletion and allows keeping the material', () => {
    const { onRemoveMaterial } = renderSection([
      makeMaterial({ id: 'material-1', label: 'Frontend Resume' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete material Frontend Resume' }));
    expect(screen.getByText(/Delete this material/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep material: Frontend Resume' }));
    expect(onRemoveMaterial).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete material Frontend Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete material: Frontend Resume' }));

    expect(onRemoveMaterial).toHaveBeenCalledWith('material-1');
  });

  it('restores focus to the add button after cancelling the form', async () => {
    renderSection([]);

    fireEvent.click(screen.getByRole('button', { name: 'Add material' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add material' })).toHaveFocus(),
    );
  });

  it('keeps the editor open with entered values when the save callback fails', () => {
    const { onAddMaterial } = renderSection([]);
    onAddMaterial.mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: 'Add material' }));
    fireEvent.change(screen.getByLabelText(/Label/), {
      target: { value: 'Draft resume' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));

    expect(screen.getByRole('heading', { name: 'Add material' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Label/)).toHaveValue('Draft resume');
    expect(screen.getByRole('alert')).toHaveTextContent('Changes could not be saved');
  });

  it('keeps the delete confirmation open when the removal callback fails', () => {
    const { onRemoveMaterial } = renderSection([
      makeMaterial({ id: 'material-1', label: 'Frontend Resume' }),
    ]);
    onRemoveMaterial.mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: 'Delete material Frontend Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete material: Frontend Resume' }));

    expect(screen.getByText(/Delete this material/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Changes could not be saved');
  });
});

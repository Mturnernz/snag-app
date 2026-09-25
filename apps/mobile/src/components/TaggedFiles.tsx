import React from 'react';
import { View } from 'react-native';

import { Group, Row, SectionTitle } from './Grouped';
import { describeFileHome, documentName } from '@snag/supabase-queries';
import { FILE_TAGS, FILE_TAG_LABELS, type FileTags, type ProjectFile } from '@snag/shared-types';
import { getFileUrl } from '../lib/supabase';
import { openUrl } from '../lib/openUrl';
import { showAlert } from '../lib/alert';

interface Props {
  files: ProjectFile[];
  tags: FileTags;
}

const HEADINGS = {
  compliance: 'Compliance certificates',
  product_sheet: 'Product sheets',
  warranty: 'Warranties',
  other: 'Other paperwork',
} as const;

/**
 * The job's paperwork, gathered by what it is, wherever it is attached.
 *
 * The certificate somebody is asked for at code compliance was filed on the
 * electrician's bill, the product sheet on the heat pump, the warranty on the
 * oven's price. Each stays where it was put — this is a read over
 * `project_files`, never a second place a file lives — and every row says
 * where it is attached, so the answer to "where's the CoC" is one screen.
 *
 * **Untagged paperwork is not listed here.** It used to be, under *On prices
 * and parts*, because the section below showed only the job's own files and a
 * quote's PDF was on no screen but the quote's. The Documents section now lists
 * every file on the job grouped by supplier, so this keeps to the one question
 * it answers better than any grouping: which file is the certificate.
 *
 * Absent entirely when there is nothing to gather: a heading over nothing is a
 * prompt nobody asked for, the shopping pill's rule at zero.
 */
export default function TaggedFiles({ files, tags }: Props) {
  const tagged = files.filter((f) => f.kind === 'document' && tags[f.path]);
  if (tagged.length === 0) return null;

  async function open(path: string) {
    const url = await getFileUrl(path);
    if (!url) {
      showAlert("Couldn't open that", 'The link to this document could not be made.');
      return;
    }
    openUrl(url);
  }

  return (
    <View>
      {FILE_TAGS.map((tag) => {
        const these = tagged.filter((f) => tags[f.path] === tag);
        if (these.length === 0) return null;
        return (
          <View key={tag}>
            <SectionTitle title={HEADINGS[tag]} count={these.length} />
            <Group>
              {these.map((f) => (
                <Row
                  key={f.path}
                  title={documentName(f.path)}
                  subtitle={`${FILE_TAG_LABELS[tag]} · ${whereFrom(f)}`}
                  onPress={() => open(f.path)}
                  accessibilityLabel={`Open ${documentName(f.path)}`}
                />
              ))}
            </Group>
          </View>
        );
      })}
    </View>
  );
}

/** Who a tagged file came from, or where on the job it is when nobody sent it. */
function whereFrom(file: ProjectFile): string {
  if (file.supplier) return `from ${file.supplier}`;
  const home = describeFileHome(file);
  return home.charAt(0).toLowerCase() + home.slice(1);
}

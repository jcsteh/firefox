/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "AccAttributes.h"
#include "StyleInfo.h"
#include "mozilla/ToString.h"
#include "nsAtom.h"

using namespace mozilla::a11y;

bool AccAttributes::GetAttribute(nsAtom* aAttrName,
                                 nsAString& aAttrValue) const {
  if (auto value = Lookup(aAttrName)) {
    StringFromValueAndName(aAttrName, *value, aAttrValue);
    return true;
  }

  return false;
}

void AccAttributes::StringFromValueAndName(nsAtom* aAttrName,
                                           const AttrValueType& aValue,
                                           nsAString& aValueString) {
  aValueString.Truncate();

  aValue.match(
      [&aValueString](const bool& val) {
        aValueString.Assign(val ? u"true" : u"false");
      },
      [&aValueString](const float& val) {
        aValueString.AppendFloat(val * 100);
        aValueString.Append(u"%");
      },
      [&aValueString](const double& val) { aValueString.AppendFloat(val); },
      [&aValueString](const int32_t& val) { aValueString.AppendInt(val); },
      [&aValueString](const RefPtr<nsAtom>& val) {
        val->ToString(aValueString);
      },
      [&aValueString](const nsTArray<int32_t>& val) {
        if (const size_t len = val.Length()) {
          for (size_t i = 0; i < len - 1; i++) {
            aValueString.AppendInt(val[i]);
            aValueString.Append(u", ");
          }
          aValueString.AppendInt(val[len - 1]);
        } else {
          // The array is empty
          NS_WARNING(
              "Hmm, should we have used a DeleteEntry() for this instead?");
          aValueString.Append(u"[ ]");
        }
      },
      [&aValueString](const CSSCoord& val) {
        aValueString.AppendFloat(val);
        aValueString.Append(u"px");
      },
      [&aValueString](const FontSize& val) {
        aValueString.AppendInt(val.mValue);
        aValueString.Append(u"pt");
      },
      [&aValueString](const Color& val) {
        StyleInfo::FormatColor(val.mValue, aValueString);
      },
      [&aValueString](const DeleteEntry& val) {
        aValueString.Append(u"-delete-entry-");
      },
      [&aValueString](const UniquePtr<nsString>& val) {
        aValueString.Assign(*val);
      },
      [&aValueString](const RefPtr<AccAttributes>& val) {
        aValueString.Assign(u"AccAttributes{...}");
      },
      [&aValueString](const uint64_t& val) { aValueString.AppendInt(val); },
      [&aValueString](const UniquePtr<AccGroupInfo>& val) {
        aValueString.Assign(u"AccGroupInfo{...}");
      },
      [&aValueString](const UniquePtr<gfx::Matrix4x4>& val) {
        aValueString.AppendPrintf("Matrix4x4=%s", ToString(*val).c_str());
      },
      [&aValueString](const nsTArray<uint64_t>& val) {
        if (const size_t len = val.Length()) {
          for (size_t i = 0; i < len - 1; i++) {
            aValueString.AppendInt(val[i]);
            aValueString.Append(u", ");
          }
          aValueString.AppendInt(val[len - 1]);
        } else {
          // The array is empty
          NS_WARNING(
              "Hmm, should we have used a DeleteEntry() for this instead?");
          aValueString.Append(u"[ ]");
        }
      },
      [&aValueString](const nsTArray<TextOffsetAttribute>& val) {
        if (const size_t len = val.Length()) {
          for (size_t i = 0; i < len - 1; i++) {
            aValueString.AppendPrintf("(%d, %d, ", val[i].mStartOffset,
                                      val[i].mEndOffset);
            aValueString.Append(nsAtomString(val[i].mAttribute));
            aValueString.Append(u"), ");
          }
          aValueString.AppendPrintf("(%d, %d, ", val[len - 1].mStartOffset,
                                    val[len - 1].mEndOffset);
          aValueString.Append(nsAtomString(val[len - 1].mAttribute));
          aValueString += ')';
        } else {
          // The array is empty
          NS_WARNING(
              "Hmm, should we have used a DeleteEntry() for this instead?");
          aValueString.Append(u"[ ]");
        }
      });
}

void AccAttributes::Update(AccAttributes* aOther) {
  for (auto& entry : aOther->mData) {
    if (entry.mValue.is<DeleteEntry>()) {
      Remove(entry.Name());
    } else {
      InsertOrUpdate(entry.Name(), std::move(entry.mValue));
    }
  }
  aOther->mData.Clear();
}

bool AccAttributes::Equal(const AccAttributes* aOther) const {
  if (Count() != aOther->Count()) {
    return false;
  }
  for (auto& entry : mData) {
    const auto otherVal = aOther->Lookup(entry.Name());
    if (!otherVal) {
      return false;
    }
    if (entry.mValue.is<UniquePtr<nsString>>()) {
      // Because we store nsString in a UniquePtr, we must handle it specially
      // so we compare the string and not the pointer.
      if (!otherVal->is<UniquePtr<nsString>>()) {
        return false;
      }
      const auto& thisStr = entry.mValue.as<UniquePtr<nsString>>();
      const auto& otherStr = otherVal->as<UniquePtr<nsString>>();
      if (*thisStr != *otherStr) {
        return false;
      }
    } else if (entry.mValue != *otherVal) {
      return false;
    }
  }
  return true;
}

void AccAttributes::CopyTo(AccAttributes* aDest) const {
  for (auto& entry : mData) {
    entry.mValue.match(
        [&entry, &aDest](const bool& val) {
          aDest->InsertOrUpdate(entry.Name(), AsVariant(val));
        },
        [&entry, &aDest](const float& val) {
          aDest->InsertOrUpdate(entry.Name(), AsVariant(val));
        },
        [&entry, &aDest](const double& val) {
          aDest->InsertOrUpdate(entry.Name(), AsVariant(val));
        },
        [&entry, &aDest](const int32_t& val) {
          aDest->InsertOrUpdate(entry.Name(), AsVariant(val));
        },
        [&entry, &aDest](const RefPtr<nsAtom>& val) {
          aDest->InsertOrUpdate(entry.Name(), AsVariant(val));
        },
        [](const nsTArray<int32_t>& val) {
          // We don't copy arrays.
          MOZ_ASSERT_UNREACHABLE(
              "Trying to copy an AccAttributes containing an array");
        },
        [&entry, &aDest](const CSSCoord& val) {
          aDest->InsertOrUpdate(entry.Name(), AsVariant(val));
        },
        [&entry, &aDest](const FontSize& val) {
          aDest->InsertOrUpdate(entry.Name(), AsVariant(val));
        },
        [&entry, &aDest](const Color& val) {
          aDest->InsertOrUpdate(entry.Name(), AsVariant(val));
        },
        [](const DeleteEntry& val) {
          // We don't copy DeleteEntry.
          MOZ_ASSERT_UNREACHABLE(
              "Trying to copy an AccAttributes containing a DeleteEntry");
        },
        [&entry, &aDest](const UniquePtr<nsString>& val) {
          aDest->SetAttributeStringCopy(entry.Name(), *val);
        },
        [](const RefPtr<AccAttributes>& val) {
          // We don't copy nested AccAttributes.
          MOZ_ASSERT_UNREACHABLE(
              "Trying to copy an AccAttributes containing an AccAttributes");
        },
        [&entry, &aDest](const uint64_t& val) {
          aDest->InsertOrUpdate(entry.Name(), AsVariant(val));
        },
        [](const UniquePtr<AccGroupInfo>& val) {
          MOZ_ASSERT_UNREACHABLE(
              "Trying to copy an AccAttributes containing an AccGroupInfo");
        },
        [](const UniquePtr<gfx::Matrix4x4>& val) {
          MOZ_ASSERT_UNREACHABLE(
              "Trying to copy an AccAttributes containing a matrix");
        },
        [](const nsTArray<uint64_t>& val) {
          // We don't copy arrays.
          MOZ_ASSERT_UNREACHABLE(
              "Trying to copy an AccAttributes containing an array");
        },
        [](const nsTArray<TextOffsetAttribute>& val) {
          // We don't copy arrays.
          MOZ_ASSERT_UNREACHABLE(
              "Trying to copy an AccAttributes containing an array");
        });
  }
}

#ifdef A11Y_LOG
void AccAttributes::DebugPrint(const char* aPrefix,
                               const AccAttributes& aAttributes) {
  nsAutoString prettyString;
  prettyString.AssignLiteral("{\n");
  for (const auto& iter : aAttributes) {
    nsAutoString name;
    iter.NameAsString(name);

    nsAutoString value;
    iter.ValueAsString(value);
    prettyString.AppendLiteral("  ");
    prettyString.Append(name);
    prettyString.AppendLiteral(": ");
    prettyString.Append(value);
    prettyString.AppendLiteral("\n");
  }

  prettyString.AppendLiteral("}");
  printf("%s %s\n", aPrefix, NS_ConvertUTF16toUTF8(prettyString).get());
}
#endif

size_t AccAttributes::SizeOfIncludingThis(MallocSizeOf aMallocSizeOf) {
  size_t size =
      aMallocSizeOf(this) + mData.ShallowSizeOfExcludingThis(aMallocSizeOf);

  for (auto& iter : mData) {
    size += iter.SizeOfExcludingThis(aMallocSizeOf);
  }

  return size;
}

size_t AccAttributes::Entry::SizeOfExcludingThis(MallocSizeOf aMallocSizeOf) {
  size_t size = 0;

  // We don't count the size of Name() since it's counted by the atoms table
  // memory reporter.

  if (mValue.is<nsTArray<int32_t>>()) {
    size += mValue.as<nsTArray<int32_t>>().ShallowSizeOfExcludingThis(
        aMallocSizeOf);
  } else if (mValue.is<UniquePtr<nsString>>()) {
    // String data will never be shared.
    size += mValue.as<UniquePtr<nsString>>()->SizeOfIncludingThisIfUnshared(
        aMallocSizeOf);
  } else if (mValue.is<RefPtr<AccAttributes>>()) {
    size +=
        mValue.as<RefPtr<AccAttributes>>()->SizeOfIncludingThis(aMallocSizeOf);
  } else if (mValue.is<UniquePtr<AccGroupInfo>>()) {
    size += mValue.as<UniquePtr<AccGroupInfo>>()->SizeOfIncludingThis(
        aMallocSizeOf);
  } else if (mValue.is<UniquePtr<gfx::Matrix4x4>>()) {
    size += aMallocSizeOf(mValue.as<UniquePtr<gfx::Matrix4x4>>().get());
  } else if (mValue.is<nsTArray<uint64_t>>()) {
    size += mValue.as<nsTArray<uint64_t>>().ShallowSizeOfExcludingThis(
        aMallocSizeOf);
  } else {
    // This type is stored directly and already counted or is an atom and
    // stored and counted in the atoms table.
    // Assert that we have exhausted all the remaining variant types.
    MOZ_ASSERT(mValue.is<RefPtr<nsAtom>>() || mValue.is<bool>() ||
               mValue.is<float>() || mValue.is<double>() ||
               mValue.is<int32_t>() || mValue.is<uint64_t>() ||
               mValue.is<CSSCoord>() || mValue.is<FontSize>() ||
               mValue.is<Color>() || mValue.is<DeleteEntry>());
  }

  return size;
}

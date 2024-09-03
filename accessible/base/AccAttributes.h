/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef AccAttributes_h_
#define AccAttributes_h_

#include "mozilla/ServoStyleConsts.h"
#include "mozilla/a11y/AccGroupInfo.h"
#include "mozilla/Variant.h"
#include "nsTHashMap.h"
#include "nsStringFwd.h"
#include "mozilla/gfx/Matrix.h"

class nsVariant;

namespace IPC {
template <typename T>
struct ParamTraits;
}  // namespace IPC

namespace mozilla {

namespace dom {
class Element;
}

namespace a11y {

struct FontSize {
  int32_t mValue;

  bool operator==(const FontSize& aOther) const {
    return mValue == aOther.mValue;
  }

  bool operator!=(const FontSize& aOther) const {
    return mValue != aOther.mValue;
  }
};

struct Color {
  nscolor mValue;

  bool operator==(const Color& aOther) const { return mValue == aOther.mValue; }

  bool operator!=(const Color& aOther) const { return mValue != aOther.mValue; }
};

// A special type. If an entry has a value of this type, it instructs the
// target instance of an Update to remove the entry with the same key value.
struct DeleteEntry {
  DeleteEntry() : mValue(true) {}
  bool mValue;

  bool operator==(const DeleteEntry& aOther) const { return true; }

  bool operator!=(const DeleteEntry& aOther) const { return false; }
};

/**
 * An attribute that applies to an offset range in a text leaf. This allows it
 * to span only part of a text leaf. This is used for spelling errors,
 * highlights, etc. which are mapped to DOM selections. This is in contrast to
 * most other attributes which can only apply to an entire text leaf and so just
 * reside on the leaf itself, rather than requiring offsets.
 */
struct TextOffsetAttribute {
  // The offset in the text leaf where the attribute starts. If this is -1, the
  // attribute begins before this leaf, crossing Accessibles.
  int32_t mStartOffset;
  // The offset in the text leaf where the attribute ends (exclusive). If this
  // is -1, the attribute ends after this leaf, crossing Accessibles.
  int32_t mEndOffset;
  // The attribute:
  // nsGkAtoms::mark: Semantic highlights such as text fragments.
  // nsGkAtoms::spelling: spelling errors
  RefPtr<nsAtom> mAttribute;

  bool operator==(const TextOffsetAttribute& aOther) const {
    return mStartOffset == aOther.mStartOffset &&
           mEndOffset == aOther.mEndOffset && mAttribute == aOther.mAttribute;
  }

  bool operator!=(const TextOffsetAttribute& aOther) const {
    return !(*this == aOther);
  }

  bool operator<(const TextOffsetAttribute& aOther) const {
    return mStartOffset < aOther.mStartOffset;
  }
};

class AccAttributes {
  // Warning! An AccAttributes can contain another AccAttributes. This is
  // intended for object and text attributes. However, the nested
  // AccAttributes should never itself contain another AccAttributes, nor
  // should it create a cycle. We don't do cycle collection here for
  // performance reasons, so violating this rule will cause leaks!
  using AttrValueType =
      Variant<bool, float, double, int32_t, RefPtr<nsAtom>, nsTArray<int32_t>,
              CSSCoord, FontSize, Color, DeleteEntry, UniquePtr<nsString>,
              RefPtr<AccAttributes>, uint64_t, UniquePtr<AccGroupInfo>,
              UniquePtr<gfx::Matrix4x4>, nsTArray<uint64_t>,
              nsTArray<TextOffsetAttribute>>;
  static_assert(sizeof(AttrValueType) <= 16);

  class Entry {
   public:
    Entry(nsAtom* aAttrName, AttrValueType&& aAttrValue)
        : mName(aAttrName), mValue(std::move(aAttrValue)) {}

    Entry(const Entry& aOther) = delete;
    Entry& operator=(const Entry&) = delete;
    Entry(Entry&&) = default;

    nsAtom* Name() const { return mName; }

    template <typename T>
    Maybe<const T&> Value() const {
      if constexpr (std::is_same_v<nsString, T>) {
        if (mValue.is<UniquePtr<nsString>>()) {
          const T& val = *(mValue.as<UniquePtr<nsString>>().get());
          return SomeRef(val);
        }
      } else if constexpr (std::is_same_v<gfx::Matrix4x4, T>) {
        if (mValue.is<UniquePtr<gfx::Matrix4x4>>()) {
          const T& val = *(mValue.as<UniquePtr<gfx::Matrix4x4>>());
          return SomeRef(val);
        }
      } else {
        if (mValue.is<T>()) {
          const T& val = mValue.as<T>();
          return SomeRef(val);
        }
      }
      return Nothing();
    }

    void NameAsString(nsString& aName) const {
      mName->ToString(aName);
      if (StringBeginsWith(aName, u"aria-"_ns)) {
        // Found 'aria-'
        aName.ReplaceLiteral(0, 5, u"");
      }
    }

    void ValueAsString(nsAString& aValueString) const {
      StringFromValueAndName(mName, mValue, aValueString);
    }

    // Size of the pair in the hash table.
    size_t SizeOfExcludingThis(MallocSizeOf aMallocSizeOf);

   private:
    nsAtom* mName;
    AttrValueType mValue;

    friend class AccAttributes;
    friend struct IPC::ParamTraits<AccAttributes*>;
  };

  using AtomVariantMap = nsTArray<Entry>;

 protected:
  ~AccAttributes() = default;

 public:
  AccAttributes() = default;
  AccAttributes(const AccAttributes&) = delete;
  AccAttributes& operator=(const AccAttributes&) = delete;

  NS_INLINE_DECL_REFCOUNTING(mozilla::a11y::AccAttributes)

  template <typename T>
  void SetAttribute(nsAtom* aAttrName, T&& aAttrValue) {
    using ValType =
        std::remove_const_t<std::remove_reference_t<decltype(aAttrValue)>>;
    if constexpr (std::is_convertible_v<ValType, nsString>) {
      static_assert(std::is_rvalue_reference_v<decltype(aAttrValue)>,
                    "Please only move strings into this function. To make a "
                    "copy, use SetAttributeStringCopy.");
      UniquePtr<nsString> value = MakeUnique<nsString>(std::move(aAttrValue));
      InsertOrUpdate(aAttrName, AsVariant(std::move(value)));
    } else if constexpr (std::is_same_v<ValType, gfx::Matrix4x4>) {
      UniquePtr<gfx::Matrix4x4> value = MakeUnique<gfx::Matrix4x4>(aAttrValue);
      InsertOrUpdate(aAttrName, AsVariant(std::move(value)));
    } else if constexpr (std::is_same_v<ValType, AccGroupInfo*>) {
      UniquePtr<AccGroupInfo> value(aAttrValue);
      InsertOrUpdate(aAttrName, AsVariant(std::move(value)));
    } else if constexpr (std::is_convertible_v<ValType, nsAtom*>) {
      InsertOrUpdate(aAttrName, AsVariant(RefPtr<nsAtom>(aAttrValue)));
    } else {
      InsertOrUpdate(aAttrName, AsVariant(std::forward<T>(aAttrValue)));
    }
  }

  void SetAttributeStringCopy(nsAtom* aAttrName, nsString aAttrValue) {
    SetAttribute(aAttrName, std::move(aAttrValue));
  }

  template <typename T>
  Maybe<const T&> GetAttribute(nsAtom* aAttrName) const {
    if (auto value = Lookup(aAttrName)) {
      if constexpr (std::is_same_v<nsString, T>) {
        if (value->is<UniquePtr<nsString>>()) {
          const T& val = *(value->as<UniquePtr<nsString>>().get());
          return SomeRef(val);
        }
      } else if constexpr (std::is_same_v<gfx::Matrix4x4, T>) {
        if (value->is<UniquePtr<gfx::Matrix4x4>>()) {
          const T& val = *(value->as<UniquePtr<gfx::Matrix4x4>>());
          return SomeRef(val);
        }
      } else {
        if (value->is<T>()) {
          const T& val = value->as<T>();
          return SomeRef(val);
        }
      }
    }
    return Nothing();
  }

  template <typename T>
  RefPtr<const T> GetAttributeRefPtr(nsAtom* aAttrName) const {
    if (auto value = Lookup(aAttrName)) {
      if (value->is<RefPtr<T>>()) {
        RefPtr<const T> ref = value->as<RefPtr<T>>();
        return ref;
      }
    }
    return nullptr;
  }

  template <typename T>
  Maybe<T&> GetMutableAttribute(nsAtom* aAttrName) {
    static_assert(std::is_same_v<nsTArray<int32_t>, T> ||
                      std::is_same_v<nsTArray<uint64_t>, T>,
                  "Only arrays should be mutable attributes");
    for (auto& entry : mData) {
      if (entry.Name() != aAttrName) {
        continue;
      }
      if (entry.mValue.is<T>()) {
        T& val = entry.mValue.as<T>();
        return SomeRef(val);
      }
      break;
    }
    return Nothing();
  }

  // Get stringified value
  bool GetAttribute(nsAtom* aAttrName, nsAString& aAttrValue) const;

  bool HasAttribute(nsAtom* aAttrName) const { return !!Lookup(aAttrName); }

  bool Remove(nsAtom* aAttrName) {
    for (auto iter = mData.begin(); iter != mData.end(); ++iter) {
      if (iter->mName == aAttrName) {
        mData.RemoveElementAt(iter);
        return true;
      }
    }
    return false;
  }

  uint32_t Count() const { return mData.Length(); }

  // Update one instance with the entries in another. The supplied AccAttributes
  // will be emptied.
  void Update(AccAttributes* aOther);

  /**
   * Return true if all the attributes in this instance are equal to all the
   * attributes in another instance.
   */
  bool Equal(const AccAttributes* aOther) const;

  /**
   * Copy attributes from this instance to another instance.
   * This should only be used in very specific cases; e.g. merging two sets of
   * cached attributes without modifying the cache. It can only copy simple
   * value types; e.g. it can't copy array values. Attempting to copy an
   * AccAttributes with uncopyable values will cause an assertion.
   */
  void CopyTo(AccAttributes* aDest) const;

  AtomVariantMap::const_iterator begin() const { return mData.begin(); }
  AtomVariantMap::const_iterator end() const { return mData.end(); }

#ifdef A11Y_LOG
  static void DebugPrint(const char* aPrefix, const AccAttributes& aAttributes);
#endif

  size_t SizeOfIncludingThis(MallocSizeOf aMallocSizeOf);

 private:
  static void StringFromValueAndName(nsAtom* aAttrName,
                                     const AttrValueType& aValue,
                                     nsAString& aValueString);

  Maybe<const AttrValueType&> Lookup(nsAtom* aKey) const {
    for (auto& entry : mData) {
      if (entry.Name() == aKey) {
        return SomeRef(entry.mValue);
      }
    }
    return Nothing();
  }

  void InsertOrUpdate(nsAtom* aKey, AttrValueType&& aValue) {
    for (auto& entry : mData) {
      if (entry.Name() == aKey) {
        entry.mValue = std::move(aValue);
        return;
      }
    }
    mData.EmplaceBack(Entry(aKey, std::move(aValue)));
  }

  AtomVariantMap mData;

  friend struct IPC::ParamTraits<AccAttributes*>;
};

}  // namespace a11y
}  // namespace mozilla

#endif

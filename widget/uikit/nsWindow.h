/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef NSWINDOW_H_
#define NSWINDOW_H_

#include "nsBaseWidget.h"
#include "gfxPoint.h"

#include "nsTArray.h"

@class UIWindow;
@class UIView;
@class ChildView;

namespace mozilla::layers {
class NativeLayerRootCA;
}

namespace mozilla::widget {
class TextInputHandler;
}

#define NS_WINDOW_IID                                \
  {                                                  \
    0x5e6fd559, 0xb3f9, 0x40c9, {                    \
      0x92, 0xd1, 0xef, 0x80, 0xb4, 0xf9, 0x69, 0xe9 \
    }                                                \
  }

class nsWindow final : public nsBaseWidget {
 public:
  nsWindow();

  NS_DECLARE_STATIC_IID_ACCESSOR(NS_WINDOW_IID)

  NS_DECL_ISUPPORTS_INHERITED

  //
  // nsIWidget
  //

  [[nodiscard]] virtual nsresult Create(
      nsIWidget* aParent, nsNativeWidget aNativeParent,
      const LayoutDeviceIntRect& aRect,
      mozilla::widget::InitData* aInitData = nullptr) override;
  virtual void Destroy() override;
  virtual void Show(bool aState) override;
  virtual void Enable(bool aState) override {}
  virtual bool IsEnabled() const override { return true; }
  virtual bool IsVisible() const override { return mVisible; }
  virtual void SetFocus(Raise, mozilla::dom::CallerType aCallerType) override;
  virtual LayoutDeviceIntPoint WidgetToScreenOffset() override;

  virtual void SetBackgroundColor(const nscolor& aColor) override;
  virtual void* GetNativeData(uint32_t aDataType) override;

  virtual void Move(double aX, double aY) override;
  virtual nsSizeMode SizeMode() override { return mSizeMode; }
  virtual void SetSizeMode(nsSizeMode aMode) override;
  void EnteredFullScreen(bool aFullScreen);
  virtual void Resize(double aWidth, double aHeight, bool aRepaint) override;
  virtual void Resize(double aX, double aY, double aWidth, double aHeight,
                      bool aRepaint) override;
  virtual LayoutDeviceIntRect GetScreenBounds() override;
  void ReportMoveEvent();
  void ReportSizeEvent();
  void ReportSizeModeEvent(nsSizeMode aMode);

  CGFloat BackingScaleFactor();
  void BackingScaleFactorChanged();
  virtual float GetDPI() override {
    // XXX: terrible
    return 326.0f;
  }
  virtual double GetDefaultScaleInternal() override {
    return BackingScaleFactor();
  }
  virtual int32_t RoundsWidgetCoordinatesTo() override;

  virtual nsresult SetTitle(const nsAString& aTitle) override { return NS_OK; }

  virtual void Invalidate(const LayoutDeviceIntRect& aRect) override;
  virtual nsresult DispatchEvent(mozilla::WidgetGUIEvent* aEvent,
                                 nsEventStatus& aStatus) override;

  void WillPaintWindow();
  bool PaintWindow(LayoutDeviceIntRegion aRegion);

  bool HasModalDescendents() { return false; }

  // virtual nsresult
  // NotifyIME(const IMENotification& aIMENotification) override;
  virtual void SetInputContext(const InputContext& aContext,
                               const InputContextAction& aAction) override;
  virtual InputContext GetInputContext() override;
  virtual TextEventDispatcherListener* GetNativeTextEventDispatcherListener()
      override;

  mozilla::widget::TextInputHandler* GetTextInputHandler() const {
    return mTextInputHandler;
  }
  bool IsVirtualKeyboardDisabled() const;

  /*
  virtual bool ExecuteNativeKeyBinding(
                      NativeKeyBindingsType aType,
                      const mozilla::WidgetKeyboardEvent& aEvent,
                      DoCommandCallback aCallback,
                      void* aCallbackData) override;
  */

  RefPtr<mozilla::layers::NativeLayerRoot> GetNativeLayerRoot() override;

  void HandleMainThreadCATransaction();

  // Called when the main thread enters a phase during which visual changes
  // are imminent and any layer updates on the compositor thread would interfere
  // with visual atomicity.
  // "Async" CATransactions are CATransactions which happen on a thread that's
  // not the main thread.
  void SuspendAsyncCATransactions();

  // Called when we know that the current main thread paint will be completed
  // once the main thread goes back to the event loop.
  void MaybeScheduleUnsuspendAsyncCATransactions();

  // Called from the runnable dispatched by
  // MaybeScheduleUnsuspendAsyncCATransactions(). At this point we know that the
  // main thread is done handling the visual change (such as a window resize)
  // and we can start modifying CALayers from the compositor thread again.
  void UnsuspendAsyncCATransactions();

  static already_AddRefed<nsWindow> From(nsPIDOMWindowOuter* aDOMWindow);
  static already_AddRefed<nsWindow> From(nsIWidget* aWidget);

 protected:
  virtual ~nsWindow();
  void BringToFront();
  nsWindow* FindTopLevel();
  bool IsTopLevel();
  nsresult GetCurrentOffset(uint32_t& aOffset, uint32_t& aLength);
  nsresult DeleteRange(int aOffset, int aLen);

  void TearDownView();

  ChildView* mNativeView;
  bool mVisible;
  nsSizeMode mSizeMode;
  nsTArray<nsWindow*> mChildren;
  nsWindow* mParent;

  mozilla::widget::InputContext mInputContext;
  RefPtr<mozilla::widget::TextInputHandler> mTextInputHandler;

  RefPtr<mozilla::layers::NativeLayerRootCA> mNativeLayerRoot;

  RefPtr<mozilla::CancelableRunnable> mUnsuspendAsyncCATransactionsRunnable;

  void OnSizeChanged(const mozilla::gfx::IntSize& aSize);

  static void DumpWindows();
  static void DumpWindows(const nsTArray<nsWindow*>& wins, int indent = 0);
  static void LogWindow(nsWindow* win, int index, int indent);
};

NS_DEFINE_STATIC_IID_ACCESSOR(nsWindow, NS_WINDOW_IID)

#endif /* NSWINDOW_H_ */

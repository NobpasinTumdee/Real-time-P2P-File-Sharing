# How to build for mobile
```
npm install @capacitor/core @capacitor/cli
```
```
npx cap init
```
```
npm run build
```
```
npm install @capacitor/android @capacitor/ios
npx cap add android
npx cap add ios
```
```
npx cap sync
```

## run this command for open Android studio If you can't run this Command you can run Android studio then open Project folder.
```
npx cap open android
```


## when you build APK you can see your apk file from this path \android\app\build\outputs\apk\debug\

# update project and rebuild
```
npm run build
npx cap sync
npx cap open android
```
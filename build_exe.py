import PyInstaller.__main__
import os
import customtkinter

# Get the path to customtkinter's data files
ctk_path = os.path.dirname(customtkinter.__file__)

PyInstaller.__main__.run([
    'main.py',
    '--noconsole',
    '--onefile',
    '--name=TuitilityYTDL',
    f'--add-data={ctk_path};customtkinter/',
    '--collect-all=yt_dlp',
    # '--icon=icon.ico', # Add icon here if you have one
])

print("\n\nBuild Complete! Your EXE is in the 'dist' folder.")
